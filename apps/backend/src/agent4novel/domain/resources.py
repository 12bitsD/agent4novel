from collections.abc import Callable
from typing import Any, Literal, Self

from pydantic import Field, field_validator, model_serializer, model_validator

from ..config import parse_model_id
from ..contracts import SafeCount, SafeInt, StrictModel, is_absent
from .work import ExtensionSection

AuthorStepId = Literal["caption", "creative", "outline", "setting", "beat", "prose"]
PreferenceName = Literal["style", "genre", "payoff"]
UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
AUTHOR_STEP_IDS: tuple[AuthorStepId, ...] = (
    "caption",
    "creative",
    "outline",
    "setting",
    "beat",
    "prose",
)


class AuthorPreferences(StrictModel):
    style: str | None = Field(default=None, exclude_if=is_absent, max_length=500)
    genre: str | None = Field(default=None, exclude_if=is_absent, max_length=500)
    payoff: str | None = Field(default=None, exclude_if=is_absent, max_length=500)


class AuthorStepConfig(StrictModel):
    thinking: Literal["enabled", "disabled"] | None = None
    temperature: float | None = Field(default=None, ge=0, le=1)
    topP: float | None = Field(default=None, gt=0, le=1)
    model: str | None = None
    systemPromptRef: str | None = None
    skills: list[str] | None = Field(default=None, max_length=4)
    tools: list[str] | None = Field(default=None, max_length=0)
    directionCount: int | None = Field(default=None, ge=1, le=3)

    @model_validator(mode="before")
    @classmethod
    def optional_fields_are_not_null(cls, value: Any) -> Any:
        if isinstance(value, dict):
            for key, item in value.items():
                if key != "systemPromptRef" and item is None:
                    raise ValueError(f"{key} may be omitted but not null")
        return value

    @model_serializer(mode="wrap")
    def omit_unset_fields(self, handler: Callable[..., dict[str, Any]]) -> dict[str, Any]:
        values = handler(self)
        return {key: value for key, value in values.items() if key in self.model_fields_set}

    @field_validator("model")
    @classmethod
    def valid_model(cls, value: str | None) -> str | None:
        if value is not None:
            parse_model_id(value)
        return value

    @field_validator("systemPromptRef", "skills")
    @classmethod
    def valid_file_references(cls, value: Any) -> Any:
        import re

        references = [value] if isinstance(value, str) else value or []
        if any(re.fullmatch(UUID_PATTERN, reference) is None for reference in references):
            raise ValueError("invalid file reference")
        return value

    @model_validator(mode="after")
    def unique_skills(self) -> Self:
        if self.skills is not None and len(set(self.skills)) != len(self.skills):
            raise ValueError("skills must be unique")
        return self


class AuthorConfigDocument(StrictModel):
    preferences: AuthorPreferences
    defaults: AuthorStepConfig
    steps: dict[AuthorStepId, AuthorStepConfig]


class AuthorConfigSave(StrictModel):
    requestId: str = Field(pattern=UUID_PATTERN)
    expectedRevision: int = Field(ge=0, le=9_007_199_254_740_991)
    document: AuthorConfigDocument


class AuthorConfigReceipt(StrictModel):
    workId: str = Field(min_length=1)
    requestId: str = Field(pattern=UUID_PATTERN)
    revision: SafeInt
    document: AuthorConfigDocument


class AgentFile(StrictModel):
    id: str = Field(pattern=UUID_PATTERN)
    workId: str = Field(min_length=1)
    kind: Literal["prompt", "skill"]
    name: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64)
    description: str = Field(min_length=1, max_length=1024)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    byteLength: int = Field(gt=0, le=32_768)
    createdAt: str


class AgentFileUpload(StrictModel):
    requestId: str = Field(pattern=UUID_PATTERN)
    kind: Literal["prompt", "skill"]
    text: str = Field(min_length=1, max_length=32_768)


class EffectiveAuthorStep(StrictModel):
    id: AuthorStepId
    model: str
    provider: Literal["deepseek", "longcat", "kimi"]
    configured: bool
    executionMode: Literal["demo", "live"]
    generation: dict[str, Any]
    appliedPreferences: dict[Literal["style", "genre", "payoff"], str]
    systemPrompt: AgentFile | None
    skills: list[AgentFile] = Field(max_length=4)
    tools: list[str] = Field(default=[], max_length=0)
    directionCount: int = Field(ge=1, le=3)


class AuthorConfigView(StrictModel):
    workId: str = Field(min_length=1)
    revision: SafeCount
    document: AuthorConfigDocument
    files: list[AgentFile] = Field(max_length=64)
    effective: list[EffectiveAuthorStep] = Field(min_length=6, max_length=6)

    @model_validator(mode="after")
    def identities_match(self) -> Self:
        if len({step.id for step in self.effective}) != 6:
            raise ValueError("configuration identity mismatch")
        if len({file.id for file in self.files}) != len(self.files):
            raise ValueError("configuration identity mismatch")
        if any(file.workId != self.workId for file in self.files):
            raise ValueError("configuration identity mismatch")
        library = {file.id: file for file in self.files}
        for step in self.effective:
            if step.systemPrompt is not None and step.systemPrompt != library.get(
                step.systemPrompt.id
            ):
                raise ValueError("configuration identity mismatch")
            if len({file.id for file in step.skills}) != len(step.skills):
                raise ValueError("configuration identity mismatch")
            if any(file != library.get(file.id) for file in step.skills):
                raise ValueError("configuration identity mismatch")
        return self


class AgentFileRead(StrictModel):
    file: AgentFile
    text: str = Field(min_length=1, max_length=32_768)


class ArtifactRef(StrictModel):
    artifactId: str = Field(min_length=1, max_length=128)
    version: SafeInt


class SettingExtensionItemDraft(StrictModel):
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1, max_length=20_000)

    @field_validator("title", mode="before")
    @classmethod
    def trim_raw_title(cls, value: Any) -> str:
        if not isinstance(value, str) or len(value) > 256 or not value.strip():
            raise ValueError("invalid title")
        return value.strip()

    @field_validator("content", mode="before")
    @classmethod
    def trim_raw_content(cls, value: Any) -> str:
        if not isinstance(value, str) or len(value) > 20_000 or not value.strip():
            raise ValueError("invalid content")
        return value.strip()


class SettingExtensionDraft(StrictModel):
    title: str = Field(min_length=1, max_length=256)
    items: list[SettingExtensionItemDraft] = Field(min_length=1, max_length=256)

    @field_validator("title", mode="before")
    @classmethod
    def trim_raw_title(cls, value: Any) -> str:
        if not isinstance(value, str) or len(value) > 256 or not value.strip():
            raise ValueError("invalid title")
        return value.strip()


class SettingExtensionProposeRequest(StrictModel):
    requestId: str = Field(pattern=UUID_PATTERN)
    expectedBase: ArtifactRef
    extension: SettingExtensionDraft


class PersistedSettingExtensionRequest(SettingExtensionProposeRequest):
    workId: str = Field(min_length=1)


class SettingExtensionActionRequest(StrictModel):
    requestId: str = Field(pattern=UUID_PATTERN)
    expectedBase: ArtifactRef


class SettingExtension(ExtensionSection):
    pass


class SettingExtensionProposalRecord(StrictModel):
    workId: str = Field(min_length=1)
    requestId: str = Field(pattern=UUID_PATTERN)
    expectedBase: ArtifactRef
    request: PersistedSettingExtensionRequest
    extension: SettingExtension
    status: Literal["pending", "approved", "cancelled"]
    candidate: ArtifactRef | None
    createdAt: str
    updatedAt: str

    @model_validator(mode="after")
    def request_matches(self) -> Self:
        if self.request.workId != self.workId or self.request.requestId != self.requestId:
            raise ValueError("request identity mismatch")
        if self.request.expectedBase != self.expectedBase:
            raise ValueError("request expectedBase mismatch")
        if self.extension.title != self.request.extension.title or len(self.extension.items) != len(
            self.request.extension.items
        ):
            raise ValueError("extension mismatch")
        for item, requested in zip(self.extension.items, self.request.extension.items, strict=True):
            if item.title != requested.title or item.content != requested.content:
                raise ValueError("extension item mismatch")
        if self.status == "approved" and self.candidate is None:
            raise ValueError("approved record requires candidate")
        if self.status in {"pending", "cancelled"} and self.candidate is not None:
            raise ValueError("non-approved record cannot have candidate")
        return self


class SettingExtensionProposalRef(StrictModel):
    workId: str = Field(min_length=1)
    requestId: str = Field(pattern=UUID_PATTERN)


class SettingExtensionReceipt(StrictModel):
    requestId: str = Field(pattern=UUID_PATTERN)
    workId: str = Field(min_length=1)
    operation: Literal["propose", "approve", "cancel"]
    outcome: Literal["success", "failed", "unknown"]
    writeOutcome: Literal["committed", "not-committed", "unknown"]
    proposal: SettingExtensionProposalRef | None
    candidate: ArtifactRef | None
    errorCode: str | None


class SettingExtensionImpact(StrictModel):
    observedAt: str
    approvedChapterCount: SafeCount
    pendingChapterCount: SafeCount
    continuityWarning: bool
    historicalArtifactsUnchanged: Literal[True] = True
    futureGeneration: Literal["uses-after-approval"] = "uses-after-approval"
    automaticRewrite: Literal[False] = False
    existingFactMutation: Literal[False] = False

    @model_validator(mode="after")
    def warning_matches(self) -> Self:
        if self.continuityWarning != (self.approvedChapterCount > 0):
            raise ValueError("continuityWarning must reflect approvedChapterCount")
        return self


class NoneSettingExtensionResource(StrictModel):
    kind: Literal["setting-extension"] = "setting-extension"
    workId: str = Field(min_length=1)
    requestId: str
    status: Literal["none"] = "none"
    impact: SettingExtensionImpact
    proposal: None = None
    base: None = None
    extension: None = None
    candidate: None = None
    createdAt: None = None
    updatedAt: None = None


class ExistingSettingExtensionResource(StrictModel):
    kind: Literal["setting-extension"] = "setting-extension"
    workId: str = Field(min_length=1)
    requestId: str
    status: Literal["pending", "approved", "cancelled", "stale"]
    impact: SettingExtensionImpact
    proposal: SettingExtensionProposalRef
    base: ArtifactRef
    extension: SettingExtension
    candidate: ArtifactRef | None
    createdAt: str
    updatedAt: str


class BadExampleSelection(StrictModel):
    chapter: int = Field(gt=0, le=9_007_199_254_740_991)
    sourceArtifactId: str = Field(min_length=1, max_length=256)
    sourceVersion: int = Field(gt=0, le=9_007_199_254_740_991)
    sourceHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    start: int = Field(ge=0, le=9_007_199_254_740_991)
    end: int = Field(ge=0, le=9_007_199_254_740_991)
    text: str = Field(min_length=1, max_length=10_000)
    note: str = Field(default="", max_length=2000)

    @field_validator("text", "note")
    @classmethod
    def utf16_text_budget(cls, value: str, info: Any) -> str:
        maximum = 10_000 if info.field_name == "text" else 2000
        if len(value.encode("utf-16-le", errors="surrogatepass")) // 2 > maximum:
            raise ValueError("text exceeds UTF-16 budget")
        return value

    @field_validator("text")
    @classmethod
    def paired_surrogates(cls, value: str) -> str:
        import re

        if re.search(
            r"[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]",
            value,
        ):
            raise ValueError("unpaired surrogate")
        return value

    @model_validator(mode="after")
    def valid_range(self) -> Self:
        if (
            self.end <= self.start
            or self.end - self.start != len(self.text.encode("utf-16-le")) // 2
        ):
            raise ValueError("invalid text range")
        if not self.text.strip():
            raise ValueError("text is empty")
        return self


class BadExampleRequest(BadExampleSelection):
    requestId: str = Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )


class BadExample(BadExampleSelection):
    id: str = Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )
    workId: str = Field(min_length=1)
    createdAt: str


class BadExamplePage(StrictModel):
    workId: str = Field(min_length=1)
    chapter: SafeInt | None = Field(default=None, exclude_if=is_absent)
    after: SafeInt | None = Field(default=None, exclude_if=is_absent)
    items: list[BadExample] = Field(max_length=50)
    nextCursor: SafeInt | None = Field(default=None, exclude_if=is_absent)

    @model_validator(mode="after")
    def valid_page(self) -> Self:
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("duplicate bad example")
        if any(item.workId != self.workId for item in self.items):
            raise ValueError("bad example work mismatch")
        if self.chapter is not None and any(item.chapter != self.chapter for item in self.items):
            raise ValueError("bad example chapter mismatch")
        if self.nextCursor is not None and (
            len(self.items) != 50 or self.nextCursor <= (self.after or 0)
        ):
            raise ValueError("invalid cursor")
        return self


def matches_bad_example(record: BadExample, work_id: str, request: dict[str, Any]) -> bool:
    if record.workId != work_id or record.id != request.get("requestId"):
        return False
    for key in (
        "chapter",
        "sourceArtifactId",
        "sourceVersion",
        "sourceHash",
        "start",
        "end",
        "text",
        "note",
    ):
        if getattr(record, key) != request.get(key):
            return False
    return True
