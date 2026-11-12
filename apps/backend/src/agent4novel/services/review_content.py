import re
from typing import Any
from uuid import uuid4

from ..domain.drafts import BeatEditDraft, BeatReviewDraft, OutlineDraft, SettingReviewDraft
from ..domain.work import BeatContent, OutlineContent, SettingContent


class SettingValidationError(ValueError):
    def __init__(self, issues: list[dict[str, Any]]) -> None:
        super().__init__("invalid setting content")
        self.issues = issues


def _next_id(prefix: str, existing: list[str]) -> str:
    values = []
    for value in existing:
        match = re.search(r"(\d+)$", value)
        if match:
            values.append(int(match.group(1)))
    return f"{prefix}{max(values, default=0) + 1}"


def normalize_outline_ids(work_id: str, draft: OutlineDraft) -> OutlineContent:
    arc_ids = [arc.arcId or "" for arc in draft.arcs]
    used_segment_ids = {segment.segmentId or "" for arc in draft.arcs for segment in arc.segments}
    arcs = []
    for arc in draft.arcs:
        arc_id = arc.arcId or _next_id(f"{work_id}-arc-", arc_ids)
        arc_ids.append(arc_id)
        segment_ids = [segment.segmentId or "" for segment in arc.segments]
        segments = []
        for segment in arc.segments:
            segment_id = segment.segmentId
            if segment_id is None:
                while True:
                    segment_id = _next_id(f"{arc_id}-seg-", segment_ids)
                    if segment_id not in used_segment_ids:
                        break
                segment_ids.append(segment_id)
                used_segment_ids.add(segment_id)
            segments.append({**segment.model_dump(exclude_none=True), "segmentId": segment_id})
        arcs.append(
            {
                **arc.model_dump(exclude_none=True),
                "arcId": arc_id,
                "segments": segments,
            }
        )
    return OutlineContent.model_validate({"arcs": arcs})


def assign_setting_ids(
    draft: SettingReviewDraft | Any,
    baseline: SettingContent | None = None,
) -> SettingContent:
    if baseline is not None:
        item_ids = {
            item.itemId
            for column in (
                baseline.world,
                baseline.characters,
                baseline.factions,
                baseline.relationships,
            )
            for item in column
        }
        item_ids.update(item.itemId for section in baseline.extensions for item in section.items)
        section_ids = {section.sectionId for section in baseline.extensions}
        issues = []

        def check(value: str | None, allowed: set[str], path: list[str | int]) -> None:
            if value is not None and value not in allowed:
                issues.append(
                    {"path": path, "code": "custom", "message": "身份标识不属于当前设定的同类条目"}
                )

        for column in ("world", "characters", "factions", "relationships"):
            for index, item in enumerate(getattr(draft, column)):
                check(item.itemId, item_ids, [column, index, "itemId"])
        for index, section in enumerate(draft.extensions):
            check(section.sectionId, section_ids, ["extensions", index, "sectionId"])
            for item_index, item in enumerate(section.items):
                check(item.itemId, item_ids, ["extensions", index, "items", item_index, "itemId"])
        if issues:
            raise SettingValidationError(issues)

    used: set[str] = set()

    def collect(content: Any) -> None:
        for column in ("world", "characters", "factions", "relationships"):
            used.update(item.itemId for item in getattr(content, column) if item.itemId)
        for section in content.extensions:
            if section.sectionId:
                used.add(section.sectionId)
            used.update(item.itemId for item in section.items if item.itemId)

    collect(draft)
    if baseline is not None:
        collect(baseline)

    def new_id(prefix: str) -> str:
        while True:
            value = f"{prefix}-{uuid4()}"
            if value not in used:
                used.add(value)
                return value

    def items(values: list[Any]) -> list[dict[str, Any]]:
        return [
            {**item.model_dump(exclude_none=True), "itemId": item.itemId or new_id("item")}
            for item in values
        ]

    return SettingContent.model_validate(
        {
            "overview": draft.overview,
            "world": items(draft.world),
            "characters": items(draft.characters),
            "factions": items(draft.factions),
            "relationships": items(draft.relationships),
            "extensions": [
                {
                    **section.model_dump(exclude_none=True),
                    "sectionId": section.sectionId or new_id("section"),
                    "items": items(section.items),
                }
                for section in draft.extensions
            ],
        }
    )


class BeatValidationError(ValueError):
    def __init__(self, issues: list[dict[str, Any]]) -> None:
        super().__init__("invalid beat content")
        self.issues = issues


def assert_beat_ids(draft: Any, baseline: BeatContent | None = None) -> None:
    allowed = {item.itemId for item in baseline.writingPlan} if baseline else set()
    seen: set[str] = set()
    issues = []
    for index, item in enumerate(draft.writingPlan):
        if item.itemId is not None and (item.itemId not in allowed or item.itemId in seen):
            issues.append(
                {
                    "path": ["writingPlan", index, "itemId"],
                    "code": "custom",
                    "message": "无效的卡片身份",
                }
            )
        if item.itemId is not None:
            seen.add(item.itemId)
    if issues:
        raise BeatValidationError(issues)


def assign_beat_ids(
    draft: BeatReviewDraft | BeatEditDraft | Any,
    baseline: BeatContent | None = None,
) -> BeatContent:
    assert_beat_ids(draft, baseline)
    used: set[str] = {item.itemId for item in baseline.writingPlan} if baseline else set()
    items = []
    for item in draft.writingPlan:
        item_id = item.itemId
        while item_id is None:
            candidate = f"beat-item-{uuid4()}"
            if candidate not in used:
                item_id = candidate
        assert item_id is not None
        used.add(item_id)
        items.append({**item.model_dump(exclude_none=True), "itemId": item_id})
    return BeatContent.model_validate(
        {
            **draft.model_dump(exclude_none=True),
            "writingPlan": items,
        }
    )
