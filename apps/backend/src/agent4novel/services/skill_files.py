import contextlib
import hashlib
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import yaml

from ..domain.resources import AgentFile, AgentFileRead
from ..errors import AgentFileUnavailableError, ConfigInvalidError


@dataclass(frozen=True)
class SkillMetadata:
    name: str
    description: str
    body: str


def _contained(root: Path, target: Path) -> bool:
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def _assert_components(root: Path, target: Path, *, directory: bool) -> None:
    if not _contained(root, target):
        raise AgentFileUnavailableError
    try:
        if root.is_symlink():
            raise AgentFileUnavailableError
        current = root
        for part in target.relative_to(root).parts:
            current = current / part
            if current.is_symlink():
                raise AgentFileUnavailableError
        if directory and not target.is_dir():
            raise AgentFileUnavailableError
    except OSError as error:
        raise AgentFileUnavailableError from error


def _file_path(data_dir: Path, file: AgentFile) -> tuple[Path, Path]:
    root = Path(os.path.abspath(data_dir / "prompts"))
    target = (
        root / hashlib.sha256(file.workId.encode()).hexdigest() / file.id / file.name / "SKILL.md"
    )
    return root, target


def read_agent_file(data_dir: Path, file: AgentFile) -> AgentFileRead:
    root, target = _file_path(data_dir, file)
    _assert_components(root, target, directory=False)
    try:
        descriptor = os.open(target, os.O_RDONLY)
        try:
            stat_info = os.fstat(descriptor)
            if not stat.S_ISREG(stat_info.st_mode) or stat_info.st_size != file.byteLength:
                raise AgentFileUnavailableError
            if stat_info.st_size > 32_768:
                raise AgentFileUnavailableError
            data = bytearray()
            while len(data) <= 32_768:
                chunk = os.read(descriptor, 32_769 - len(data))
                if not chunk:
                    break
                data.extend(chunk)
        finally:
            os.close(descriptor)
    except OSError as error:
        raise AgentFileUnavailableError from error
    if len(data) != file.byteLength:
        raise AgentFileUnavailableError
    try:
        text = data.decode("utf-8")
    except UnicodeError as error:
        raise AgentFileUnavailableError from error
    if hashlib.sha256(text.encode()).hexdigest() != file.sha256:
        raise AgentFileUnavailableError
    return AgentFileRead(file=file, text=text)


def _validate_yaml_node(node: yaml.Node) -> None:
    if isinstance(node, yaml.MappingNode):
        keys = set()
        for key, value in node.value:
            if not isinstance(key, yaml.ScalarNode) or key.value in keys:
                raise ConfigInvalidError
            keys.add(key.value)
            _validate_yaml_node(key)
            _validate_yaml_node(value)
    elif isinstance(node, yaml.SequenceNode):
        for item in node.value:
            _validate_yaml_node(item)


def _without_aliases(text: str) -> None:
    if any(isinstance(event, yaml.events.AliasEvent) for event in yaml.parse(text)):
        raise ConfigInvalidError
    node = yaml.compose(text)
    if node is not None:
        _validate_yaml_node(node)


def parse_skill_text(text: str) -> SkillMetadata:
    if len(text.encode()) > 32_768:
        raise ConfigInvalidError
    match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)(.*)\Z", text, re.DOTALL)
    if match is None or len(match.group(1).encode()) > 4096 or not match.group(2).strip():
        raise ConfigInvalidError
    try:
        _without_aliases(match.group(1))
        metadata = yaml.safe_load(match.group(1))
    except yaml.YAMLError as error:
        raise ConfigInvalidError from error
    if not isinstance(metadata, dict):
        raise ConfigInvalidError
    name = metadata.get("name")
    description = metadata.get("description")
    if (
        not isinstance(name, str)
        or re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) is None
        or len(name) > 64
        or not isinstance(description, str)
        or not description.strip()
        or len(description) > 1024
    ):
        raise ConfigInvalidError
    if "license" in metadata and not isinstance(metadata["license"], str):
        raise ConfigInvalidError
    if "compatibility" in metadata and (
        not isinstance(metadata["compatibility"], str) or len(metadata["compatibility"]) > 500
    ):
        raise ConfigInvalidError
    if "allowed-tools" in metadata and not isinstance(metadata["allowed-tools"], str):
        raise ConfigInvalidError
    if "metadata" in metadata and (
        not isinstance(metadata["metadata"], dict)
        or any(not isinstance(value, str) for value in metadata["metadata"].values())
    ):
        raise ConfigInvalidError
    return SkillMetadata(name, description, match.group(2))


def ensure_private_directory(root: Path, target: Path) -> None:
    if not _contained(root, target):
        raise AgentFileUnavailableError
    try:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        _assert_components(root, root, directory=True)
        current = root
        for part in target.relative_to(root).parts:
            current = current / part
            current.mkdir(mode=0o700, exist_ok=True)
            if current.is_symlink() or not current.is_dir():
                raise AgentFileUnavailableError
    except OSError as error:
        raise AgentFileUnavailableError from error


def publish_agent_file(data_dir: Path, file: AgentFile, text: str) -> None:
    root, target = _file_path(data_dir, file)
    parent = target.parent
    ensure_private_directory(root, parent)
    _assert_components(root, parent, directory=True)
    temporary = parent / f"{target.name}.{uuid4()}.tmp"
    created = False
    try:
        if target.exists() or target.is_symlink():
            if target.is_symlink() or not target.is_file():
                raise AgentFileUnavailableError
            read_agent_file(data_dir, file)
            return
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        created = True
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(text.encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, target)
        except FileExistsError:
            read_agent_file(data_dir, file)
        temporary.unlink()
        created = False
        directory = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except (OSError, AgentFileUnavailableError) as error:
        if isinstance(error, AgentFileUnavailableError):
            raise
        raise AgentFileUnavailableError from error
    finally:
        if created:
            with contextlib.suppress(OSError):
                temporary.unlink()
