from typing import Annotated, Any, Literal

from pydantic import Field

from ..contracts import StrictModel, is_absent
from .diagnostics import LlmTelemetry
from .work import PipelineState


class AdvancedOutcome(StrictModel):
    kind: Literal["advanced"]
    stepId: str
    state: PipelineState
    beatCommand: dict[str, Any] | None = Field(default=None, exclude_if=is_absent)
    proseCommand: dict[str, Any] | None = Field(default=None, exclude_if=is_absent)
    telemetry: list[LlmTelemetry]


class AwaitingOutcome(StrictModel):
    kind: Literal["awaiting-approval"]
    state: PipelineState
    telemetry: list[LlmTelemetry]


class CompleteOutcome(StrictModel):
    kind: Literal["complete"]
    state: PipelineState
    telemetry: list[LlmTelemetry]


class FailedOutcome(StrictModel):
    kind: Literal["failed"]
    stepId: str
    code: str
    retryable: bool
    attemptId: str | None = Field(default=None, exclude_if=is_absent)
    state: PipelineState
    beatCommand: dict[str, Any] | None = Field(default=None, exclude_if=is_absent)
    proseCommand: dict[str, Any] | None = Field(default=None, exclude_if=is_absent)
    inputBudget: dict[str, Any] | None = Field(default=None, exclude_if=is_absent)
    telemetry: list[LlmTelemetry]


AdvanceOutcomeDto = Annotated[
    AdvancedOutcome | AwaitingOutcome | CompleteOutcome | FailedOutcome,
    Field(discriminator="kind"),
]
