from typing import Literal, Self

from pydantic import ConfigDict, Field, model_validator

from ..contracts import StrictModel, TrimmedModel, is_absent
from .drafts import BeatEditDraft, BeatReviewDraft, OutlineDraft, SettingReviewDraft
from .resources import ArtifactRef
from .work import (
    ArtifactKind,
    BeatContent,
    CreativeContent,
    HumanStatus,
    ProseContent,
    ProseEditDraft,
)

MAX_SAFE_INTEGER = 9_007_199_254_740_991


class StartChapterRequest(StrictModel):
    chapter: int = Field(gt=1, le=MAX_SAFE_INTEGER)
    expectedPreviousProseId: str = Field(min_length=1, max_length=128)
    expectedPreviousProseVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class WorkCreateRequest(StrictModel):
    seed: str = Field(min_length=1)
    title: str | None = Field(default=None, exclude_if=is_absent)


class CreativeDraftRequest(StrictModel):
    expectedHeadVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)
    content: CreativeContent


class SelectCreativeRequest(TrimmedModel):
    directionId: str = Field(min_length=1, max_length=64)
    expectedHeadVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class CreativeRegenerateRequest(TrimmedModel):
    expectedArtifactId: str | None = Field(min_length=1, max_length=200)
    expectedHeadVersion: int | None = Field(gt=0, le=MAX_SAFE_INTEGER)
    instructions: str = Field(max_length=4000)

    @model_validator(mode="after")
    def target_matches(self) -> Self:
        if (self.expectedArtifactId is None) != (self.expectedHeadVersion is None):
            raise ValueError("目标产物 ID 与版本必须同时为空或同时提供")
        return self


class OutlineDraftRequest(StrictModel):
    content: OutlineDraft
    expectedHeadVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class OutlineApprovalRequest(StrictModel):
    expectedArtifactId: str = Field(min_length=1, max_length=200)
    expectedHeadVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class SettingApproveRequest(StrictModel):
    content: SettingReviewDraft
    expectedHeadVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class ApproveRequest(StrictModel):
    kind: ArtifactKind
    chapter: int | None = Field(default=None, exclude_if=is_absent, gt=0, le=MAX_SAFE_INTEGER)

    @model_validator(mode="after")
    def chapter_matches_kind(self) -> Self:
        if (self.kind in {"beat", "prose"}) != (self.chapter is not None):
            raise ValueError("chapter 与产物 kind 不匹配")
        return self


class ChapterRegenerationBinding(StrictModel):
    mode: Literal["chapter-regeneration"]
    expectedBeat: ArtifactRef
    expectedProse: ArtifactRef


class BeatRequestHead(StrictModel):
    model_config = ConfigDict(extra="allow")

    chapter: int = Field(gt=0, le=MAX_SAFE_INTEGER)
    expectedArtifactId: str = Field(min_length=1, max_length=128)
    expectedHeadVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class BeatApproveRequest(BeatRequestHead):
    model_config = ConfigDict(extra="forbid")

    content: BeatReviewDraft


class BeatRegenerateRequest(BeatRequestHead):
    model_config = ConfigDict(extra="forbid")

    content: BeatEditDraft
    instructions: str = Field(max_length=10_000)
    regeneration: ChapterRegenerationBinding | None = Field(default=None, exclude_if=is_absent)

    @model_validator(mode="after")
    def binding_matches(self) -> Self:
        if self.regeneration is not None and (
            self.expectedArtifactId != self.regeneration.expectedBeat.artifactId
            or self.expectedHeadVersion != self.regeneration.expectedBeat.version
        ):
            raise ValueError("章纲重生绑定必须匹配请求基线")
        return self


class BeatVariantSelectionRequest(StrictModel):
    chapter: int = Field(gt=0, le=MAX_SAFE_INTEGER)
    expectedArtifactId: str = Field(min_length=1, max_length=128)
    expectedHeadVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)
    originalArtifactId: str = Field(min_length=1, max_length=128)
    originalVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)
    originalContent: BeatContent
    choice: Literal["new", "original"]


class ProseRequestHead(StrictModel):
    model_config = ConfigDict(extra="allow")

    chapter: int = Field(gt=0, le=MAX_SAFE_INTEGER)
    expectedArtifactId: str = Field(min_length=1, max_length=128)
    expectedHeadVersion: int = Field(gt=0, le=MAX_SAFE_INTEGER)


class ProseApproveRequest(ProseRequestHead):
    model_config = ConfigDict(extra="forbid")

    content: ProseContent


class ProseRegenerateRequest(ProseRequestHead):
    model_config = ConfigDict(extra="forbid")

    content: ProseEditDraft
    instructions: str = Field(max_length=10_000)
    regeneration: ChapterRegenerationBinding | None = Field(default=None, exclude_if=is_absent)

    @model_validator(mode="after")
    def binding_matches(self) -> Self:
        if self.regeneration is not None and (
            self.expectedArtifactId != self.regeneration.expectedProse.artifactId
            or self.expectedHeadVersion != self.regeneration.expectedProse.version
        ):
            raise ValueError("正文重生绑定必须匹配请求基线")
        return self


class ProseSaveRequestHead(ProseRequestHead):
    model_config = ConfigDict(extra="allow")

    expectedHumanStatus: HumanStatus


class ProseSaveRequest(ProseSaveRequestHead):
    model_config = ConfigDict(extra="forbid")

    content: ProseEditDraft

    @model_validator(mode="after")
    def approved_text_is_not_empty(self) -> Self:
        if self.expectedHumanStatus == "approved" and not self.content.text.strip():
            raise ValueError("已通过正文不能为空")
        return self
