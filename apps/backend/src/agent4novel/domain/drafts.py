from typing import Self

from pydantic import Field, field_validator, model_validator

from ..contracts import StrictModel, TrimmedModel, is_absent
from .work import _strip, _validate_beat_values, _validate_setting_values


class OutlineDraftSegment(TrimmedModel):
    segmentId: str | None = Field(default=None, exclude_if=is_absent, min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=30)
    summary: str = Field(min_length=1, max_length=500)
    outcome: str = Field(min_length=1, max_length=500)


class OutlineDraftArc(TrimmedModel):
    arcId: str | None = Field(default=None, exclude_if=is_absent, min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=30)
    conflict: str = Field(min_length=1, max_length=500)
    development: str = Field(min_length=1, max_length=500)
    resolution: str = Field(min_length=1, max_length=500)
    segments: list[OutlineDraftSegment] = Field(min_length=2, max_length=8)


class OutlineDraft(TrimmedModel):
    arcs: list[OutlineDraftArc] = Field(min_length=3, max_length=8)


class SettingReviewItem(StrictModel):
    itemId: str | None = Field(
        default=None,
        exclude_if=is_absent,
        min_length=1,
        max_length=96,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$",
    )
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1, max_length=20_000)

    _strip_title = field_validator("title", mode="before")(_strip)

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("内容不能为空")
        return value


class SettingReviewSection(StrictModel):
    sectionId: str | None = Field(
        default=None,
        exclude_if=is_absent,
        min_length=1,
        max_length=96,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$",
    )
    title: str = Field(min_length=1, max_length=256)
    items: list[SettingReviewItem] = Field(min_length=1, max_length=256)

    _strip_title = field_validator("title", mode="before")(_strip)


class SettingReviewDraft(StrictModel):
    overview: str = Field(min_length=1, max_length=20_000)
    world: list[SettingReviewItem] = Field(min_length=1, max_length=256)
    characters: list[SettingReviewItem] = Field(min_length=1, max_length=256)
    factions: list[SettingReviewItem] = Field(max_length=256)
    relationships: list[SettingReviewItem] = Field(max_length=256)
    extensions: list[SettingReviewSection] = Field(max_length=32)

    @field_validator("overview")
    @classmethod
    def overview_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("内容不能为空")
        return value

    @model_validator(mode="after")
    def validate_content(self) -> Self:
        _validate_setting_values(self)
        return self


class BeatReviewItem(StrictModel):
    itemId: str | None = Field(
        default=None,
        exclude_if=is_absent,
        min_length=1,
        max_length=96,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$",
    )
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1, max_length=20_000)

    _strip_title = field_validator("title", mode="before")(_strip)

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("内容不能为空")
        return value


class BeatReviewDraft(StrictModel):
    title: str = Field(min_length=1, max_length=256)
    goal: str = Field(min_length=1, max_length=20_000)
    writingPlan: list[BeatReviewItem] = Field(min_length=1, max_length=128)
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


class BeatEditItem(StrictModel):
    itemId: str | None = Field(
        default=None,
        exclude_if=is_absent,
        min_length=1,
        max_length=96,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$",
    )
    title: str = Field(max_length=256)
    content: str = Field(max_length=20_000)

    _strip_title = field_validator("title", mode="before")(_strip)


class BeatEditDraft(StrictModel):
    title: str = Field(max_length=256)
    goal: str = Field(max_length=20_000)
    writingPlan: list[BeatEditItem] = Field(max_length=128)
    ending: str = Field(max_length=20_000)

    _strip_title = field_validator("title", mode="before")(_strip)

    @model_validator(mode="after")
    def validate_content(self) -> Self:
        _validate_beat_values(self)
        return self
