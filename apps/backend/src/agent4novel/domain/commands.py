from typing import Annotated, Any, Literal, Self

from pydantic import Field, model_validator

from ..contracts import SafeCount, StrictModel, is_absent
from .diagnostics import LlmTelemetry
from .requests import ChapterRegenerationBinding
from .work import Artifact, HumanStatus, WorkflowState

MAX_SAFE_INTEGER = 9_007_199_254_740_991


class BeatHead(StrictModel):
    artifactId: str = Field(min_length=1)
    version: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class BeatResultHead(BeatHead):
    humanStatus: HumanStatus


class BeatTarget(StrictModel):
    workId: str = Field(min_length=1)
    kind: Literal["beat"] = "beat"
    chapter: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class BeatExecutionObservation(StrictModel):
    kind: Literal["execution-result"]
    requestId: str
    operation: Literal["generate-beat", "regenerate-beat", "approve-beat"]
    executionMode: Literal["demo", "live"]
    latencyMs: int | float = Field(ge=0)
    target: BeatTarget
    expectedHead: BeatHead | None
    regeneration: ChapterRegenerationBinding | None = Field(default=None, exclude_if=is_absent)
    writeOutcome: Literal["committed", "not-committed", "unknown"]
    failureStage: (
        Literal["request", "precondition", "input", "model", "output", "commit", "response"] | None
    ) = Field(default=None, exclude_if=is_absent)
    attemptIds: list[str] = Field(max_length=1000)
    resultHead: BeatResultHead | None = Field(default=None, exclude_if=is_absent)

    @model_validator(mode="after")
    def valid_observation(self) -> Self:
        if self.regeneration is not None and (
            self.operation != "regenerate-beat"
            or self.expectedHead is None
            or self.regeneration.expectedBeat.artifactId != self.expectedHead.artifactId
            or self.regeneration.expectedBeat.version != self.expectedHead.version
        ):
            raise ValueError("章节重生章纲目标不匹配")
        if (self.operation == "generate-beat") != (self.expectedHead is None):
            raise ValueError("基线与命令不匹配")
        if self.operation == "approve-beat" and self.attemptIds:
            raise ValueError("人工通过不得包含模型尝试")
        if len(set(self.attemptIds)) != len(self.attemptIds):
            raise ValueError("重复尝试")
        if self.writeOutcome == "committed":
            if self.resultHead is None or self.failureStage is not None:
                raise ValueError("提交成功必须提供结果且无失败阶段")
            approved = self.operation == "approve-beat"
            expected = self.expectedHead
            expected_version = expected.version if expected is not None else 0
            if self.resultHead.humanStatus != ("approved" if approved else "pending"):
                raise ValueError("结果状态不匹配")
            if self.resultHead.version != (expected_version if approved else expected_version + 1):
                raise ValueError("结果版本不匹配")
            if expected is not None and (
                (self.resultHead.artifactId == expected.artifactId) != approved
            ):
                raise ValueError("结果身份不匹配")
        elif self.failureStage is None or self.resultHead is not None:
            raise ValueError("失败不得虚构结果")
        return self


class BeatRejectedObservation(StrictModel):
    kind: Literal["request-rejected"]
    requestId: str
    operation: Literal["generate-beat", "regenerate-beat", "approve-beat"]
    executionMode: Literal["demo", "live"]
    latencyMs: int | float = Field(ge=0)
    writeOutcome: Literal["not-committed"] = "not-committed"
    regeneration: ChapterRegenerationBinding | None = Field(default=None, exclude_if=is_absent)
    failureStage: Literal["request"] = "request"
    attemptIds: list[str] = Field(max_length=0)


BeatCommandObservation = Annotated[
    BeatExecutionObservation | BeatRejectedObservation,
    Field(discriminator="kind"),
]


class CommandWorkflow(StrictModel):
    workflowState: WorkflowState
    nextStepId: str | None
    allowedActions: list[str]


class BeatVariantComparison(StrictModel):
    original: Artifact
    candidate: Artifact


class BeatCommandResponse(StrictModel):
    artifact: Artifact
    comparison: BeatVariantComparison | None = Field(default=None, exclude_if=is_absent)
    command: BeatCommandObservation
    workflow: CommandWorkflow
    telemetry: list[LlmTelemetry]

    @model_validator(mode="after")
    def matches_command(self) -> Self:
        command = self.command
        if (
            command.kind != "execution-result"
            or command.writeOutcome != "committed"
            or command.target.chapter != self.artifact.chapter
            or command.target.kind != self.artifact.kind
            or command.target.workId != self.artifact.workId
            or command.resultHead is None
            or command.resultHead.artifactId != self.artifact.id
            or command.resultHead.version != self.artifact.version
            or command.resultHead.humanStatus != self.artifact.humanStatus
        ):
            raise ValueError("成功结果与命令观察不一致")
        return self


class BeatInputBudget(StrictModel):
    limit: int = Field(gt=0)
    actualLength: int = Field(ge=0)
    systemChars: int = Field(ge=0)
    outlineChars: int = Field(ge=0)
    settingChars: int = Field(ge=0)
    previousChapterChars: int | None = Field(default=None, exclude_if=is_absent, ge=0)
    draftChars: int = Field(ge=0)
    instructionsChars: int = Field(ge=0)


class BeatCommandErrorBody(StrictModel):
    code: str = Field(min_length=1)
    message: str
    retryable: bool
    attemptId: str | None = Field(default=None, exclude_if=is_absent)
    issues: list[dict[str, Any]] | None = Field(default=None, exclude_if=is_absent)
    issueCount: SafeCount | None = Field(default=None, exclude_if=is_absent)
    issuesTruncated: bool | None = Field(default=None, exclude_if=is_absent)
    command: BeatCommandObservation
    telemetry: list[LlmTelemetry] | None = Field(default=None, exclude_if=is_absent)
    workflow: CommandWorkflow | None = Field(default=None, exclude_if=is_absent)
    inputBudget: BeatInputBudget | None = Field(default=None, exclude_if=is_absent)

    @model_validator(mode="after")
    def failure_matches(self) -> Self:
        if self.command.writeOutcome == "committed":
            raise ValueError("错误与命令观察不一致")
        if self.command.kind == "request-rejected" and self.code not in {
            "bad-json",
            "invalid-input",
            "payload-too-large",
            "unsupported-chapter",
        }:
            raise ValueError("错误与命令观察不一致")
        return self


class BeatVariantSelectionReceipt(StrictModel):
    operation: Literal["select-beat-variant"] = "select-beat-variant"
    workId: str = Field(min_length=1)
    chapter: int = Field(gt=0, le=MAX_SAFE_INTEGER)
    expectedHead: BeatHead
    originalHead: BeatHead
    choice: Literal["new", "original"]
    writeOutcome: Literal["committed", "not-committed"]
    resultHead: BeatResultHead


class BeatVariantSelectionResponse(StrictModel):
    artifact: Artifact
    comparison: BeatVariantComparison
    choice: Literal["new", "original"]
    selection: BeatVariantSelectionReceipt


class ProseHead(StrictModel):
    artifactId: str = Field(min_length=1)
    version: int = Field(gt=0, le=MAX_SAFE_INTEGER)
    humanStatus: HumanStatus | None = Field(default=None, exclude_if=is_absent)


class ProseTarget(StrictModel):
    workId: str = Field(min_length=1)
    kind: Literal["prose"] = "prose"
    chapter: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class ProseExecutionObservation(StrictModel):
    kind: Literal["execution-result"]
    requestId: str
    operation: Literal["generate-prose", "regenerate-prose", "approve-prose", "save-prose"]
    executionMode: Literal["demo", "live"]
    latencyMs: int | float = Field(ge=0)
    target: ProseTarget
    expectedHead: ProseHead | None
    regeneration: ChapterRegenerationBinding | None = Field(default=None, exclude_if=is_absent)
    writeOutcome: Literal["committed", "not-committed", "unknown"]
    failureStage: (
        Literal["request", "precondition", "input", "model", "output", "commit", "response"] | None
    ) = Field(default=None, exclude_if=is_absent)
    attemptIds: list[str] = Field(max_length=1000)
    resultHead: ProseHead | None = Field(default=None, exclude_if=is_absent)

    @model_validator(mode="after")
    def valid_observation(self) -> Self:
        if self.regeneration is not None and (
            self.operation != "regenerate-prose"
            or self.expectedHead is None
            or self.regeneration.expectedProse.artifactId != self.expectedHead.artifactId
            or self.regeneration.expectedProse.version != self.expectedHead.version
        ):
            raise ValueError("章节重生正文目标不匹配")
        if (self.operation == "generate-prose") != (self.expectedHead is None):
            raise ValueError("基线与命令不匹配")
        if self.operation in {"approve-prose", "save-prose"} and self.attemptIds:
            raise ValueError("人工写入不得包含模型尝试")
        if (self.operation == "save-prose") != (
            self.expectedHead is not None and self.expectedHead.humanStatus is not None
        ):
            raise ValueError("保存必须绑定基线审批状态")
        if len(set(self.attemptIds)) != len(self.attemptIds):
            raise ValueError("重复尝试")
        if self.writeOutcome == "committed":
            if (
                self.resultHead is None
                or self.resultHead.humanStatus is None
                or self.failureStage is not None
            ):
                raise ValueError("提交成功必须提供结果且无失败阶段")
            approve = self.operation == "approve-prose"
            expected = self.expectedHead
            expected_status = (
                expected.humanStatus
                if self.operation == "save-prose" and expected
                else "approved"
                if approve
                else "pending"
            )
            if self.resultHead.humanStatus != expected_status:
                raise ValueError("结果状态不匹配")
            expected_version = expected.version if expected is not None else 0
            if self.resultHead.version != (expected_version if approve else expected_version + 1):
                raise ValueError("结果版本不匹配")
            if expected is not None and (
                (self.resultHead.artifactId == expected.artifactId) != approve
            ):
                raise ValueError("结果身份不匹配")
        elif self.failureStage is None or self.resultHead is not None:
            raise ValueError("失败不得虚构结果")
        return self


class ProseRejectedObservation(StrictModel):
    kind: Literal["request-rejected"]
    requestId: str
    operation: Literal["generate-prose", "regenerate-prose", "approve-prose", "save-prose"]
    executionMode: Literal["demo", "live"]
    latencyMs: int | float = Field(ge=0)
    writeOutcome: Literal["not-committed"] = "not-committed"
    regeneration: ChapterRegenerationBinding | None = Field(default=None, exclude_if=is_absent)
    failureStage: Literal["request"] = "request"
    attemptIds: list[str] = Field(max_length=0)


ProseCommandObservation = Annotated[
    ProseExecutionObservation | ProseRejectedObservation,
    Field(discriminator="kind"),
]


class ProseCommandResponse(StrictModel):
    artifact: Artifact
    command: ProseCommandObservation
    workflow: CommandWorkflow
    telemetry: list[LlmTelemetry]

    @model_validator(mode="after")
    def matches_command(self) -> Self:
        command = self.command
        if (
            command.kind != "execution-result"
            or command.writeOutcome != "committed"
            or command.target.chapter != self.artifact.chapter
            or command.target.kind != self.artifact.kind
            or command.target.workId != self.artifact.workId
            or command.resultHead is None
            or command.resultHead.artifactId != self.artifact.id
            or command.resultHead.version != self.artifact.version
            or command.resultHead.humanStatus != self.artifact.humanStatus
        ):
            raise ValueError("成功结果与命令观察不一致")
        if command.operation != "save-prose" and not self.artifact.content.text.strip():
            raise ValueError("生成或通过的正文不能为空")
        return self


class ProseInputBudget(StrictModel):
    limit: int = Field(gt=0)
    actualLength: int = Field(ge=0)
    systemChars: int = Field(ge=0)
    beatChars: int = Field(ge=0)
    settingChars: int = Field(ge=0)
    previousChapterChars: int | None = Field(default=None, exclude_if=is_absent, ge=0)
    draftChars: int = Field(ge=0)
    instructionsChars: int = Field(ge=0)


class ProseCommandErrorBody(StrictModel):
    code: str = Field(min_length=1)
    message: str
    retryable: bool
    attemptId: str | None = Field(default=None, exclude_if=is_absent)
    issues: list[dict[str, Any]] | None = Field(default=None, exclude_if=is_absent)
    issueCount: SafeCount | None = Field(default=None, exclude_if=is_absent)
    issuesTruncated: bool | None = Field(default=None, exclude_if=is_absent)
    command: ProseCommandObservation
    telemetry: list[LlmTelemetry] | None = Field(default=None, exclude_if=is_absent)
    workflow: CommandWorkflow | None = Field(default=None, exclude_if=is_absent)
    inputBudget: ProseInputBudget | None = Field(default=None, exclude_if=is_absent)

    @model_validator(mode="after")
    def failure_matches(self) -> Self:
        if self.command.writeOutcome == "committed":
            raise ValueError("错误与命令观察不一致")
        if self.command.kind == "request-rejected" and self.code not in {
            "bad-json",
            "invalid-input",
            "payload-too-large",
            "unsupported-chapter",
        }:
            raise ValueError("错误与命令观察不一致")
        return self
