import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, TypeVar

from pydantic import ValidationError

from ..domain.commands import (
    BeatExecutionObservation,
    BeatHead,
    BeatResultHead,
    ProseExecutionObservation,
    ProseHead,
)
from ..domain.diagnostics import TelemetryBuffer
from ..domain.work import Artifact
from ..errors import KnownError
from ..store.work import timestamp


@dataclass(frozen=True)
class CommandScope:
    request_id: str
    execution_mode: Literal["demo", "live"]
    started: float
    cursor: int

    @classmethod
    def create(
        cls, runtime: Any, cursor: int | None = None, request_id: str | None = None
    ) -> "CommandScope":
        from uuid import uuid4

        return cls(
            request_id=request_id or str(uuid4()),
            execution_mode=runtime.mode,
            started=time.monotonic(),
            cursor=runtime.telemetry.cursor if cursor is None else cursor,
        )


Observation = TypeVar("Observation", BeatExecutionObservation, ProseExecutionObservation)
Error = TypeVar("Error", "BeatCommandError", "ProseCommandError")


class CommandExecution:
    def __init__(self) -> None:
        self.stage = "precondition"


BeatExecution = CommandExecution
ProseExecution = CommandExecution


class BeatCommandError(ValueError):
    def __init__(self, cause: Exception, command: BeatExecutionObservation) -> None:
        super().__init__("beat command failed")
        self.cause = cause
        self.command = command


class ProseCommandError(ValueError):
    def __init__(self, cause: Exception, command: ProseExecutionObservation) -> None:
        super().__init__("prose command failed")
        self.cause = cause
        self.command = command


def _failure_code(cause: Exception, stage: str) -> str:
    if stage == "response":
        return "internal-error"
    if isinstance(cause, KnownError):
        return cause.code
    if isinstance(cause, ValidationError):
        return "llm-invalid-output" if stage in {"model", "output"} else "invalid-content"
    if hasattr(cause, "issues"):
        return "invalid-content"
    return "internal-error"


beat_failure_code = _failure_code
prose_failure_code = _failure_code


def _failure_observation(cause: Exception, stage: str) -> dict[str, Any]:
    prewrite = isinstance(cause, KnownError) and cause.code in {
        "version-conflict",
        "upstream-changed",
        "artifact-already-approved",
        "work-not-found",
    }
    return {
        "writeOutcome": "unknown"
        if stage == "response" or (stage == "commit" and not prewrite)
        else "not-committed",
        "failureStage": stage,
    }


def _record(buffer: TelemetryBuffer, work_id: str, command: Any, code: str) -> None:
    buffer.record_command(
        work_id,
        {
            "command": command.model_dump(mode="json"),
            "code": code,
            "recordedAt": timestamp(),
        },
    )


async def _observe(
    kind: Literal["beat", "prose"],
    work_id: str,
    operation: str,
    expected_head: BeatHead | ProseHead | None,
    run: Callable[[CommandExecution], Awaitable[Artifact]],
    *,
    buffer: TelemetryBuffer,
    scope: CommandScope,
    chapter: int,
    regeneration: Any,
    observation: Callable[[Any], Observation],
    result_head: Callable[..., Any],
    error_type: Callable[[Exception, Observation], Exception],
) -> tuple[Artifact, Observation]:
    execution = CommandExecution()

    def base() -> dict[str, Any]:
        return {
            "kind": "execution-result",
            "requestId": scope.request_id,
            "operation": operation,
            "target": {"workId": work_id, "kind": kind, "chapter": chapter},
            "expectedHead": expected_head,
            "executionMode": scope.execution_mode,
            "latencyMs": max(0, int((time.monotonic() - scope.started) * 1000)),
            "attemptIds": [
                entry.attemptId
                for entry in buffer.telemetry_for(work_id, scope.cursor)
                if entry.stepId == kind
            ],
            **({"regeneration": regeneration} if regeneration is not None else {}),
        }

    try:
        artifact = await run(execution)
        execution.stage = "response"
        command = observation(
            {
                **base(),
                "writeOutcome": "committed",
                "resultHead": result_head(
                    artifactId=artifact.id,
                    version=artifact.version,
                    humanStatus=artifact.humanStatus,
                ),
            }
        )
        _record(buffer, work_id, command, "ok")
        return artifact, command
    except Exception as error:
        if isinstance(error, KnownError) and error.code == "input-budget-exceeded":
            execution.stage = "input"
        if _failure_code(error, execution.stage) == "llm-invalid-output":
            execution.stage = "output"
        command = observation({**base(), **_failure_observation(error, execution.stage)})
        code = _failure_code(error, execution.stage)
        _record(buffer, work_id, command, code)
        raise error_type(error, command) from error


async def observe_beat(
    work_id: str,
    operation: str,
    expected_head: BeatHead | None,
    run: Callable[[BeatExecution], Awaitable[Artifact]],
    *,
    buffer: TelemetryBuffer,
    scope: CommandScope,
    chapter: int = 1,
    regeneration: Any = None,
) -> tuple[Artifact, BeatExecutionObservation]:
    return await _observe(
        "beat",
        work_id,
        operation,
        expected_head,
        run,
        buffer=buffer,
        scope=scope,
        chapter=chapter,
        regeneration=regeneration,
        observation=BeatExecutionObservation.model_validate,
        result_head=BeatResultHead,
        error_type=BeatCommandError,
    )


async def observe_prose(
    work_id: str,
    operation: str,
    expected_head: ProseHead | None,
    run: Callable[[ProseExecution], Awaitable[Artifact]],
    *,
    buffer: TelemetryBuffer,
    scope: CommandScope,
    chapter: int = 1,
    regeneration: Any = None,
) -> tuple[Artifact, ProseExecutionObservation]:
    return await _observe(
        "prose",
        work_id,
        operation,
        expected_head,
        run,
        buffer=buffer,
        scope=scope,
        chapter=chapter,
        regeneration=regeneration,
        observation=ProseExecutionObservation.model_validate,
        result_head=ProseHead,
        error_type=ProseCommandError,
    )


def _response_error(
    work_id: str,
    committed: Observation,
    cause: Exception,
    *,
    buffer: TelemetryBuffer,
    scope: CommandScope,
    observation: Callable[[Any], Observation],
    error_type: Callable[[Exception, Observation], Error],
) -> Error:
    values = committed.model_dump(exclude={"resultHead"})
    command = observation(
        {
            **values,
            **_failure_observation(cause, "response"),
            "latencyMs": max(0, int((time.monotonic() - scope.started) * 1000)),
        }
    )
    _record(buffer, work_id, command, "internal-error")
    return error_type(cause, command)


def beat_response_error(
    work_id: str,
    committed: BeatExecutionObservation,
    cause: Exception,
    *,
    buffer: TelemetryBuffer,
    scope: CommandScope,
) -> BeatCommandError:
    return _response_error(
        work_id,
        committed,
        cause,
        buffer=buffer,
        scope=scope,
        observation=BeatExecutionObservation.model_validate,
        error_type=BeatCommandError,
    )


def prose_response_error(
    work_id: str,
    committed: ProseExecutionObservation,
    cause: Exception,
    *,
    buffer: TelemetryBuffer,
    scope: CommandScope,
) -> ProseCommandError:
    return _response_error(
        work_id,
        committed,
        cause,
        buffer=buffer,
        scope=scope,
        observation=ProseExecutionObservation.model_validate,
        error_type=ProseCommandError,
    )
