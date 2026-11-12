from typing import Any, Literal, Self

from pydantic import Field, field_validator, model_validator

from ..contracts import SafeCount, SafeInt, StrictModel, TrimmedModel, is_absent
from ..text import utf16_length

ArtifactKind = Literal["caption", "creative", "outline", "setting", "beat", "prose"]
HumanStatus = Literal["pending", "approved"]
WorkflowState = Literal[
    "ready-to-generate",
    "awaiting-selection",
    "awaiting-outline-review",
    "outline-approved",
    "awaiting-setting-review",
    "setting-approved",
    "awaiting-beat-review",
    "beat-approved",
    "awaiting-prose-review",
    "prose-approved",
    "failed",
]
PER_CHAPTER_KINDS = {"beat", "prose"}


class AgentConfigFile(StrictModel):
    id: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class AgentConfig(StrictModel):
    model: str | None = Field(default=None, exclude_if=is_absent)
    systemPrompt: str | None = Field(default=None, exclude_if=is_absent)
    skills: list[str] | None = Field(default=None, exclude_if=is_absent)
    tools: list[str] | None = Field(default=None, exclude_if=is_absent)
    directionCount: int | None = Field(default=None, exclude_if=is_absent, ge=1, le=3)
    thinking: Literal["enabled", "disabled"] | None = Field(default=None, exclude_if=is_absent)
    temperature: float | None = Field(default=None, exclude_if=is_absent, ge=0, le=1)
    topP: float | None = Field(default=None, exclude_if=is_absent, gt=0, le=1)
    configRevision: SafeCount | None = Field(default=None, exclude_if=is_absent)
    configFiles: list[AgentConfigFile] | None = Field(
        default=None, exclude_if=is_absent, max_length=5
    )


class Work(StrictModel):
    id: str = Field(min_length=1)
    title: str
    seed: str
    config: AgentConfig
    createdAt: str = Field(min_length=1)


class WorkSummary(StrictModel):
    id: str = Field(min_length=1)
    title: str
    seedPreview: str
    chapterCount: SafeCount


class ArtifactInput(StrictModel):
    kind: ArtifactKind
    chapter: SafeInt | None = Field(default=None, exclude_if=is_absent)
    artifactId: str = Field(min_length=1)
    version: SafeInt

    @model_validator(mode="after")
    def chapter_matches_kind(self) -> Self:
        if (self.kind in PER_CHAPTER_KINDS) != (self.chapter is not None):
            raise ValueError("input chapter 与 kind 不匹配")
        return self


class CaptionElement(TrimmedModel):
    kind: str = Field(min_length=1, max_length=20)
    content: str = Field(min_length=1, max_length=500)


class CaptionContent(TrimmedModel):
    inputStage: Literal["脑洞", "设定", "主线", "模板"]
    summary: str = Field(min_length=1, max_length=2000)
    elements: list[CaptionElement] = Field(max_length=20)
    gaps: list[str] = Field(max_length=10)


class Hint(TrimmedModel):
    title: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=500)


class CreativePack(TrimmedModel):
    directionId: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=100)
    hook: str = Field(min_length=1, max_length=500)
    tags: list[str] = Field(max_length=8)
    synopsis: str = Field(min_length=1, max_length=2000)
    characters: list[Hint] = Field(max_length=8)
    setting: list[Hint] = Field(max_length=12)
    payoffs: list[str] = Field(max_length=8)
    outline: list[Hint] = Field(max_length=12)


class CreativeDraftPack(TrimmedModel):
    title: str = Field(min_length=1, max_length=100)
    hook: str = Field(min_length=1, max_length=500)
    tags: list[str] = Field(max_length=8)
    synopsis: str = Field(min_length=1, max_length=2000)
    characters: list[Hint] = Field(max_length=8)
    setting: list[Hint] = Field(max_length=12)
    payoffs: list[str] = Field(max_length=8)
    outline: list[Hint] = Field(max_length=12)


class CreativeContent(StrictModel):
    directions: list[CreativePack] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def unique_direction_ids(self) -> Self:
        ids = [direction.directionId for direction in self.directions]
        if len(set(ids)) != len(ids):
            raise ValueError("directionId must be unique")
        if any(len(set(direction.tags)) != len(direction.tags) for direction in self.directions):
            raise ValueError("tags must be unique")
        return self


class OutlineSegment(TrimmedModel):
    segmentId: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=30)
    summary: str = Field(min_length=1, max_length=500)
    outcome: str = Field(min_length=1, max_length=500)


class OutlineArc(TrimmedModel):
    arcId: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=30)
    conflict: str = Field(min_length=1, max_length=500)
    development: str = Field(min_length=1, max_length=500)
    resolution: str = Field(min_length=1, max_length=500)
    segments: list[OutlineSegment] = Field(min_length=2, max_length=8)


class OutlineContent(TrimmedModel):
    arcs: list[OutlineArc] = Field(min_length=3, max_length=8)

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        arc_ids = [arc.arcId for arc in self.arcs]
        segment_ids = [segment.segmentId for arc in self.arcs for segment in arc.segments]
        if len(set(arc_ids)) != len(arc_ids):
            raise ValueError("arcId must be unique")
        if len(set(segment_ids)) != len(segment_ids):
            raise ValueError("segmentId must be unique")
        return self


def _strip(value: Any) -> Any:
    return value.strip() if isinstance(value, str) else value


class SettingItem(StrictModel):
    itemId: str = Field(min_length=1, max_length=96, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1, max_length=20_000)

    _strip_title = field_validator("title", mode="before")(_strip)

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("内容不能为空")
        return value


class ExtensionSection(StrictModel):
    sectionId: str = Field(min_length=1, max_length=96, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
    title: str = Field(min_length=1, max_length=256)
    items: list[SettingItem] = Field(min_length=1, max_length=256)

    _strip_title = field_validator("title", mode="before")(_strip)


def _validate_setting_values(value: Any) -> None:
    sections = [*value.world, *value.characters, *value.factions, *value.relationships]
    extension_items = [item for section in value.extensions for item in section.items]
    cards = [*sections, *extension_items]
    ids = [item.itemId for item in cards if item.itemId is not None]
    ids.extend(section.sectionId for section in value.extensions if section.sectionId is not None)
    if len(set(ids)) != len(ids):
        raise ValueError("身份标识重复")
    if len(cards) > 256:
        raise ValueError("设定卡片总数不能超过 256")
    chars = utf16_length(value.overview) + sum(
        utf16_length(item.title) + utf16_length(item.content) for item in cards
    )
    chars += sum(utf16_length(section.title) for section in value.extensions)
    if chars > 200_000:
        raise ValueError("设定文本总量不能超过 200000 字符")


class SettingContent(StrictModel):
    overview: str = Field(min_length=1, max_length=20_000)
    world: list[SettingItem] = Field(min_length=1, max_length=256)
    characters: list[SettingItem] = Field(min_length=1, max_length=256)
    factions: list[SettingItem] = Field(max_length=256)
    relationships: list[SettingItem] = Field(max_length=256)
    extensions: list[ExtensionSection] = Field(max_length=32)

    @field_validator("overview")
    @classmethod
    def overview_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("内容不能为空")
        return value

    @model_validator(mode="after")
    def unique_ids_and_budget(self) -> Self:
        _validate_setting_values(self)
        return self


def _validate_beat_values(value: Any) -> None:
    ids = [item.itemId for item in value.writingPlan if item.itemId is not None]
    if len(set(ids)) != len(ids):
        raise ValueError("身份标识重复")
    chars = utf16_length(value.title) + utf16_length(value.goal) + utf16_length(value.ending)
    chars += sum(
        utf16_length(item.title) + utf16_length(item.content) for item in value.writingPlan
    )
    if chars > 100_000:
        raise ValueError("章纲文本总量超限")


class BeatItem(StrictModel):
    itemId: str = Field(min_length=1, max_length=96, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1, max_length=20_000)

    _strip_title = field_validator("title", mode="before")(_strip)

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("内容不能为空")
        return value


class BeatContent(StrictModel):
    title: str = Field(min_length=1, max_length=256)
    goal: str = Field(min_length=1, max_length=20_000)
    writingPlan: list[BeatItem] = Field(min_length=1, max_length=128)
    ending: str = Field(min_length=1, max_length=20_000)

    _strip_title = field_validator("title", mode="before")(_strip)

    @field_validator("goal", "ending")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("内容不能为空")
        return value

    @model_validator(mode="after")
    def validate_content(self) -> Self:
        _validate_beat_values(self)
        return self


class ProseContent(StrictModel):
    text: str = Field(max_length=100_000)

    @model_validator(mode="after")
    def nonempty(self) -> Self:
        if not self.text.strip():
            raise ValueError("内容不能为空")
        return self


class ProseEditDraft(StrictModel):
    text: str = Field(max_length=100_000)


class PreviousChapter(StrictModel):
    chapter: int = Field(gt=0, le=9_007_199_254_740_991)
    beat: BeatContent
    prose: ProseContent


CONTENT_MODELS = {
    "caption": CaptionContent,
    "creative": CreativeContent,
    "outline": OutlineContent,
    "setting": SettingContent,
    "beat": BeatContent,
}


class Artifact(StrictModel):
    id: str = Field(min_length=1)
    workId: str = Field(min_length=1)
    kind: ArtifactKind
    chapter: SafeInt | None = Field(default=None, exclude_if=is_absent)
    version: SafeInt
    content: Any
    humanStatus: HumanStatus
    createdAt: str = Field(min_length=1)
    inputs: list[ArtifactInput] | None = Field(default=None, exclude_if=is_absent)

    @model_validator(mode="after")
    def validate_content(self) -> Self:
        if (self.kind in PER_CHAPTER_KINDS) != (self.chapter is not None):
            raise ValueError("chapter 与产物 kind 不匹配")
        model: Any
        if self.kind == "prose":
            model = ProseContent if self.humanStatus == "approved" else ProseEditDraft
        else:
            model = CONTENT_MODELS[self.kind]
        self.content = model.model_validate(self.content)
        return self


class WorkDetail(Work):
    artifacts: list[Artifact]

    @model_validator(mode="after")
    def validate_artifacts(self) -> Self:
        heads = set()
        for artifact in self.artifacts:
            if artifact.workId != self.id:
                raise ValueError("产物必须属于当前作品")
            address = (artifact.kind, artifact.chapter)
            if address in heads:
                raise ValueError("同一产物地址只能有一个当前版本")
            heads.add(address)
        return self


class ChapterSummary(StrictModel):
    chapter: SafeInt
    title: str
    beatStatus: HumanStatus | None
    proseStatus: HumanStatus | None
    allowedActions: list[str]
    needsContinuityReview: bool


class WorkView(WorkDetail):
    currentChapter: SafeInt = Field(default=1)
    chapters: list[ChapterSummary] = []
    workflowState: WorkflowState
    allowedActions: list[str]
    nextStepId: str | None


class GateRef(StrictModel):
    kind: ArtifactKind
    chapter: SafeInt | None = Field(default=None, exclude_if=is_absent)

    @model_validator(mode="after")
    def chapter_matches_kind(self) -> Self:
        if (self.kind in PER_CHAPTER_KINDS) != (self.chapter is not None):
            raise ValueError("chapter 与 kind 不匹配")
        return self


class PipelineState(StrictModel):
    workId: str
    stage: Literal["ready", "blocked", "awaiting-approval", "complete"]
    nextStepId: str | None
    pendingGate: GateRef | None = Field(default=None, exclude_if=is_absent)
