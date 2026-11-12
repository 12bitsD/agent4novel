import ipaddress
import os
import re
import shlex
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ServerConfig:
    data_dir: Path
    database_path: Path
    host: str
    port: int
    seed_demo: bool
    serve_web: bool


class ServerConfigError(ValueError):
    code = "server-config-invalid"


class ModelConfigError(ValueError):
    code = "llm-config-invalid"


def repository_root() -> Path:
    configured = os.environ.get("A4N_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[4]


def _environment_file(root: Path) -> dict[str, str]:
    path = root / ".env.local"
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return {}
    except OSError as error:
        raise ModelConfigError("unable to read .env.local") from error
    if len(data) > 65_536:
        raise ModelConfigError(".env.local exceeds the 64 KiB limit")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeError as error:
        raise ModelConfigError(".env.local must be valid UTF-8") from error
    values: dict[str, str] = {}
    for line_number, source in enumerate(text.splitlines(), start=1):
        line = source.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ModelConfigError(f"invalid .env.local entry at line {line_number}")
        key, raw = line.split("=", 1)
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.strip()) is None:
            raise ModelConfigError(f"invalid .env.local key at line {line_number}")
        raw = raw.strip()
        try:
            if raw.startswith(("'", '"')):
                parts = shlex.split(raw, comments=True, posix=True)
                if len(parts) != 1:
                    raise ValueError
                value = parts[0]
            else:
                value = re.sub(r"\s+#.*$", "", raw).rstrip()
        except ValueError as error:
            raise ModelConfigError(f"invalid .env.local quoting at line {line_number}") from error
        if any(ord(character) < 32 and character != "\t" for character in value):
            raise ModelConfigError(f"invalid .env.local control character at line {line_number}")
        values[key.strip()] = value
        if len(values) > 256:
            raise ModelConfigError(".env.local has too many entries")
    return values


def runtime_environment(root: Path, env: Mapping[str, str] | None = None) -> dict[str, str]:
    if env is not None:
        return dict(env)
    return {**_environment_file(root), **os.environ}


def _value(env: Mapping[str, str], name: str) -> str | None:
    text = env.get(name, "").strip()
    return text or None


def _has_control_character(value: str) -> bool:
    return any(ord(character) <= 0x1F or ord(character) == 0x7F for character in value)


def _valid_hostname(host: str) -> bool:
    if len(host) > 253:
        return False
    label = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?")
    return all(label.fullmatch(part) is not None for part in host.split("."))


def _loopback(host: str) -> bool:
    if host == "localhost" or host == "::1":
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.version == 4 and address.is_loopback


def parse_server_config(env: Mapping[str, str], root: Path) -> ServerConfig:
    raw_directory = env.get("A4N_DATA_DIR", "")
    if _has_control_character(raw_directory):
        raise ServerConfigError("A4N_DATA_DIR contains invalid characters")
    data_dir = (root / (raw_directory.strip() or ".data")).resolve()
    container = env.get("A4N_CONTAINER", "").strip() or "0"
    if container not in {"0", "1"}:
        raise ServerConfigError("A4N_CONTAINER must be 0 or 1")
    host = env.get("A4N_HOST", "").strip() or "127.0.0.1"
    if len(host) > 253 or (not _valid_hostname(host) and not _loopback(host)):
        raise ServerConfigError("A4N_HOST must be an IP address or hostname")
    if not _loopback(host) and not (container == "1" and host == "0.0.0.0"):
        raise ServerConfigError("A4N_HOST must be loopback or the explicit container listener")
    raw_port = env.get("A4N_PORT", "").strip() or "8787"
    if not raw_port.isdigit():
        raise ServerConfigError("A4N_PORT must be an integer in the allowed port range")
    port = int(raw_port)
    if port > 65535:
        raise ServerConfigError("A4N_PORT must be an integer in the allowed port range")
    seed = env.get("A4N_SEED_DEMO", "").strip() or "0"
    if seed not in {"0", "1"}:
        raise ServerConfigError("A4N_SEED_DEMO must be 0 or 1")
    web = env.get("A4N_SERVE_WEB", "").strip() or "0"
    if web not in {"0", "1"}:
        raise ServerConfigError("A4N_SERVE_WEB must be 0 or 1")
    return ServerConfig(
        data_dir=data_dir,
        database_path=data_dir / "agent4novel.sqlite",
        host=host,
        port=port,
        seed_demo=seed == "1",
        serve_web=web == "1",
    )


def parse_model_id(raw: str) -> str:
    if re.fullmatch(r"(?:deepseek|kimi):[a-zA-Z0-9_.-]{1,96}", raw):
        return raw
    if raw == "longcat:LongCat-2.0":
        return raw
    raise ModelConfigError(
        f'unsupported model id "{raw}"; expected deepseek:<model>, '
        "kimi:<model>, or longcat:LongCat-2.0"
    )


def model_is_demo(env: Mapping[str, str]) -> bool:
    deepseek_key = _value(env, "DEEPSEEK_API_KEY")
    longcat_key = _value(env, "LONGCAT_API_KEY")
    kimi_key = _value(env, "KIMI_API_KEY") or _value(env, "MOONSHOT_API_KEY")
    explicit_model = _value(env, "A4N_MODEL")
    if explicit_model:
        model_id = parse_model_id(explicit_model)
        configured = (
            bool(deepseek_key)
            if model_id.startswith("deepseek:")
            else bool(kimi_key)
            if model_id.startswith("kimi:")
            else bool(longcat_key)
        )
        if not configured:
            provider = model_id.split(":", 1)[0]
            raise ModelConfigError(
                f'A4N_MODEL selects provider "{provider}" but its API key is missing'
            )
        return False
    return not (deepseek_key or longcat_key or kimi_key)
