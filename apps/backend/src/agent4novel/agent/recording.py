import contextlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from ..store.work import timestamp

FILES = {
    "input": "input.json",
    "invocation": "invocation.json",
    "result": "result.json",
    "meta": "meta.json",
}


class StepRecordError(ValueError):
    code = "recording-failed"

    def __init__(self, reason: str) -> None:
        super().__init__("step record could not be prepared or written")
        self.reason = reason


class InvocationRecorder(Protocol):
    def capture(self, value: dict[str, Any]) -> None: ...


def reserve_step_record_dir(value: str) -> Path:
    target = Path(os.path.abspath(value))
    if target == target.parent:
        raise StepRecordError("record-directory-not-private")
    parent = target.parent
    while True:
        try:
            parent.lstat()
        except OSError as error:
            raise StepRecordError("record-directory-missing") from error
        if parent.is_symlink() or not parent.is_dir():
            raise StepRecordError("record-directory-not-private")
        if parent == parent.parent:
            break
        parent = parent.parent
    if target.exists() or target.is_symlink():
        raise StepRecordError("record-directory-collision")
    try:
        target.mkdir(mode=0o700)
        target.chmod(0o700)
    except OSError as error:
        raise StepRecordError("record-directory-not-private") from error
    return target


def git_version(root: Path) -> dict[str, Any]:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
        dirty = bool(
            subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            ).stdout.strip()
        )
        return {"gitCommit": commit if len(commit) == 40 else None, "gitDirty": dirty}
    except (OSError, subprocess.SubprocessError):
        return {"gitCommit": None, "gitDirty": None}


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _exclusive(directory: Path, name: str, value: Any) -> None:
    target = directory / name
    temporary = directory / f".{name}.{uuid4()}.tmp"
    try:
        if target.exists() or target.is_symlink():
            raise StepRecordError(f"record-file-collision:{name}")
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(_json_bytes(value))
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o600)
        os.link(temporary, target)
        temporary.unlink()
        target.chmod(0o600)
    except Exception as error:
        with contextlib.suppress(OSError):
            temporary.unlink()
        if isinstance(error, StepRecordError):
            raise
        raise StepRecordError(f"record-write-failed:{name}") from error


def _replace(directory: Path, name: str, value: Any) -> None:
    target = directory / name
    temporary = directory / f".{name}.{uuid4()}.tmp"
    try:
        if target.is_symlink() or not target.is_file():
            raise StepRecordError(f"record-file-not-regular:{name}")
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(_json_bytes(value))
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, target)
        target.chmod(0o600)
    except Exception as error:
        with contextlib.suppress(OSError):
            temporary.unlink()
        if isinstance(error, StepRecordError):
            raise
        raise StepRecordError(f"record-write-failed:{name}") from error


def _empty_invocation() -> dict[str, Any]:
    return {
        "formatVersion": 1,
        "captured": False,
        "capturedAt": None,
        "system": None,
        "prompt": None,
        "model": None,
        "attemptId": None,
        "effectiveConfig": None,
        "generation": None,
        "sdkOptions": None,
        "maxOutputTokens": None,
        "maxRetries": None,
        "requestTimeoutMs": None,
    }


def _result(
    status: str, content: Any, code: str | None, retryable: bool | None, telemetry: list[Any]
) -> dict[str, Any]:
    return {
        "formatVersion": 1,
        "status": status,
        "content": content,
        "diagnostic": {"code": code, "retryable": retryable, "error": None, "telemetry": telemetry},
    }


class StepRecorder:
    def __init__(
        self,
        directory: Path,
        request: Any,
        run_id: str,
        step_id: str,
        model: str,
    ) -> None:
        self.directory = directory
        self.request = request
        self.run_id = run_id
        self.step_id = step_id
        self.model = model
        self.started_at = timestamp()

    @classmethod
    def start(
        cls, request: Any, input_value: Any, run_id: str, step_id: str, model: str
    ) -> "StepRecorder":
        directory = Path(request.dir)
        try:
            stat = directory.lstat()
        except OSError as error:
            raise StepRecordError("record-directory-missing") from error
        if directory.is_symlink() or not directory.is_dir() or stat.st_mode & 0o077:
            raise StepRecordError("record-directory-not-private")
        recorder = cls(directory, request, run_id, step_id, model)
        _exclusive(
            directory,
            FILES["input"],
            {
                "formatVersion": 1,
                "input": input_value.model_dump(mode="json"),
                "sources": request.sources.model_dump(),
            },
        )
        _exclusive(directory, FILES["invocation"], _empty_invocation())
        _exclusive(directory, FILES["meta"], recorder._meta(False, "in-progress", None))
        return recorder

    def _meta(self, complete: bool, status: str, finished_at: str | None) -> dict[str, Any]:
        return {
            "formatVersion": 1,
            "complete": complete,
            "status": status,
            "runId": self.run_id,
            "stepId": self.step_id,
            "executionMode": "live",
            "model": self.model,
            "startedAt": self.started_at,
            "finishedAt": finished_at,
            "gitCommit": self.request.version.gitCommit,
            "gitDirty": self.request.version.gitDirty,
            "sources": self.request.sources.model_dump(),
            "files": FILES,
        }

    def capture(self, value: dict[str, Any]) -> None:
        _replace(
            self.directory,
            FILES["invocation"],
            {
                "formatVersion": 1,
                "captured": True,
                "capturedAt": timestamp(),
                **value,
            },
        )

    def finish(
        self,
        *,
        status: str,
        content: Any,
        code: str | None,
        retryable: bool | None,
        telemetry: list[Any],
    ) -> dict[str, Any]:
        try:
            _exclusive(
                self.directory,
                FILES["result"],
                _result(status, content, code, retryable, telemetry),
            )
            _replace(self.directory, FILES["meta"], self._meta(True, "complete", timestamp()))
            return {"status": "complete", "dir": str(self.directory), "error": None}
        except Exception as error:
            with contextlib.suppress(StepRecordError):
                _replace(
                    self.directory, FILES["meta"], self._meta(False, "incomplete", timestamp())
                )
            reason = error.reason if isinstance(error, StepRecordError) else "record-write-failed"
            return {"status": "failed", "dir": str(self.directory), "error": reason}


def mark_step_record_unknown(
    request: Any,
    step_id: str,
    input_value: Any,
    model: str,
    code: str,
) -> None:
    directory = Path(request.dir)
    try:
        if directory.is_symlink() or not directory.is_dir() or directory.stat().st_mode & 0o077:
            return
        try:
            old_meta = json.loads((directory / FILES["meta"]).read_text())
        except (OSError, json.JSONDecodeError):
            old_meta = {}
        if old_meta.get("complete") is True and old_meta.get("status") == "complete":
            return
        if not (directory / FILES["input"]).exists():
            _exclusive(
                directory,
                FILES["input"],
                {
                    "formatVersion": 1,
                    "input": input_value.model_dump(mode="json"),
                    "sources": request.sources.model_dump(),
                },
            )
        if not (directory / FILES["invocation"]).exists():
            _exclusive(directory, FILES["invocation"], _empty_invocation())
        if not (directory / FILES["result"]).exists():
            _exclusive(directory, FILES["result"], _result("unknown", None, code, None, []))
        meta = {
            "formatVersion": 1,
            "complete": False,
            "status": "incomplete",
            "runId": old_meta.get("runId"),
            "stepId": old_meta.get("stepId", step_id),
            "executionMode": "live",
            "model": old_meta.get("model", model),
            "startedAt": old_meta.get("startedAt", timestamp()),
            "finishedAt": timestamp(),
            "gitCommit": old_meta.get("gitCommit", request.version.gitCommit),
            "gitDirty": old_meta.get("gitDirty", request.version.gitDirty),
            "sources": old_meta.get("sources", request.sources.model_dump()),
            "files": FILES,
        }
        if (directory / FILES["meta"]).exists():
            _replace(directory, FILES["meta"], meta)
        else:
            _exclusive(directory, FILES["meta"], meta)
    except Exception:
        return
