from collections import deque
from collections.abc import Sequence
from threading import RLock
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import Field

from ..contracts import StrictModel, is_absent
from .work import AgentConfigFile

CAPACITY = 1000
MAX_SAFE_INTEGER = 9_007_199_254_740_991


class GenerationParameters(StrictModel):
    thinking: Literal["enabled", "disabled"] | None = Field(default=None, exclude_if=is_absent)
    temperature: float | None = Field(default=None, exclude_if=is_absent, ge=0, le=1)
    topP: float | None = Field(default=None, exclude_if=is_absent, gt=0, le=1)


class LlmTelemetry(StrictModel):
    requestId: UUID | None = Field(default=None, exclude_if=is_absent)
    chapter: int | None = Field(default=None, exclude_if=is_absent, gt=0, le=MAX_SAFE_INTEGER)
    stepId: str
    attemptId: str
    model: str
    ok: bool
    latencyMs: int | float = Field(ge=0)
    inputTokens: int | float | None = Field(default=None, exclude_if=is_absent, ge=0)
    outputTokens: int | float | None = Field(default=None, exclude_if=is_absent, ge=0)
    finishReason: str | None = Field(default=None, exclude_if=is_absent)
    error: str | None = Field(default=None, exclude_if=is_absent)
    generation: GenerationParameters | None = Field(default=None, exclude_if=is_absent)
    promptChars: int | float = Field(ge=0)
    promptHash: str
    systemHash: str
    configRevision: int | None = Field(
        default=None, exclude_if=is_absent, ge=0, le=MAX_SAFE_INTEGER
    )
    configFiles: list[AgentConfigFile] | None = Field(
        default=None, exclude_if=is_absent, max_length=5
    )


class DiagnosticQuery(StrictModel):
    requestId: UUID | None = Field(default=None, exclude_if=is_absent)
    attemptId: str | None = Field(
        default=None,
        exclude_if=is_absent,
        min_length=1,
        max_length=128,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )


class CommandSummary(StrictModel):
    command: dict[str, Any]
    code: str = Field(min_length=1)
    recordedAt: str


class BufferWindow(StrictModel):
    capacity: Literal[1000] = 1000
    oldestSeq: int | None = Field(gt=0)
    latestSeq: int | None = Field(gt=0)
    truncated: bool


class DiagnosticWindow(StrictModel):
    processInstanceId: UUID
    retention: Literal["process-memory"] = "process-memory"
    llm: BufferWindow
    commands: BufferWindow


class DiagnosticResponse(StrictModel):
    workId: str = Field(min_length=1)
    telemetry: list[LlmTelemetry]
    commands: list[CommandSummary]
    window: DiagnosticWindow


class TelemetryBuffer:
    def __init__(self) -> None:
        self._lock = RLock()
        self._sequence = 0
        self._command_sequence = 0
        self._process_instance_id = uuid4()
        self._entries: deque[tuple[int, str, LlmTelemetry]] = deque(maxlen=CAPACITY)
        self._commands: deque[tuple[int, str, CommandSummary]] = deque(maxlen=CAPACITY)

    @property
    def cursor(self) -> int:
        with self._lock:
            return self._sequence

    def record_telemetry(self, work_id: str, value: LlmTelemetry | dict[str, Any]) -> None:
        telemetry = LlmTelemetry.model_validate(value)
        with self._lock:
            self._sequence += 1
            self._entries.append((self._sequence, work_id, telemetry))

    def record_command(self, work_id: str, value: CommandSummary | dict[str, Any]) -> None:
        command = CommandSummary.model_validate(value)
        with self._lock:
            self._command_sequence += 1
            self._commands.append((self._command_sequence, work_id, command))

    def telemetry_for(self, work_id: str, after_sequence: int = 0) -> list[LlmTelemetry]:
        with self._lock:
            return [
                entry
                for sequence, entry_work_id, entry in self._entries
                if entry_work_id == work_id and sequence > after_sequence
            ]

    @staticmethod
    def _window(entries: Sequence[tuple[int, Any, Any]], latest: int) -> BufferWindow:
        return BufferWindow(
            oldestSeq=entries[0][0] if entries else None,
            latestSeq=entries[-1][0] if entries else None,
            truncated=latest > CAPACITY,
        )

    def diagnostics_for(
        self,
        work_id: str,
        request_id: str | None = None,
        attempt_id: str | None = None,
    ) -> DiagnosticResponse:
        with self._lock:
            telemetry = [
                entry
                for _, entry_work_id, entry in self._entries
                if entry_work_id == work_id
                and (request_id is None or str(entry.requestId) == request_id)
                and (attempt_id is None or entry.attemptId == attempt_id)
            ]
            commands = [
                summary
                for _, entry_work_id, summary in self._commands
                if entry_work_id == work_id
                and (request_id is None or summary.command.get("requestId") == request_id)
                and (attempt_id is None or attempt_id in summary.command.get("attemptIds", []))
            ]
            return DiagnosticResponse(
                workId=work_id,
                telemetry=telemetry,
                commands=commands,
                window=DiagnosticWindow(
                    processInstanceId=self._process_instance_id,
                    llm=self._window(list(self._entries), self._sequence),
                    commands=self._window(list(self._commands), self._command_sequence),
                ),
            )
