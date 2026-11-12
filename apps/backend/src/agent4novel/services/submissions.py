import re
from typing import Any, Literal

from pydantic import Field, ValidationError

from ..contracts import SafeInt, StrictModel, is_absent
from ..domain.commands import (
    BeatCommandErrorBody,
    BeatCommandResponse,
    ProseCommandErrorBody,
    ProseCommandResponse,
)
from ..domain.requests import (
    BeatApproveRequest,
    ProseApproveRequest,
    ProseSaveRequest,
    SettingApproveRequest,
)
from ..domain.work import Artifact, WorkView

NEW_CARD_ID = re.compile(
    r"beat-item-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
    re.IGNORECASE,
)
REJECTION_STATUSES = {
    "work-not-found": 404,
    "artifact-not-found": 404,
    "version-conflict": 409,
    "artifact-already-approved": 409,
    "beat-gate-not-ready": 409,
    "prose-gate-not-ready": 409,
    "upstream-changed": 409,
    "advance-in-progress": 409,
    "beat-approval-required": 409,
    "prose-approval-required": 409,
    "invalid-content": 422,
    "input-budget-exceeded": 422,
    "llm-invalid-output": 502,
    "llm-unavailable": 503,
    "llm-timeout": 504,
}


class ObservedHead(StrictModel):
    artifactId: str
    version: SafeInt
    humanStatus: Literal["pending", "approved"]


class Recovery(StrictModel):
    resolution: Literal["confirmed", "rejected", "uncertain", "conflict"]
    nextActions: list[
        Literal[
            "edit-input",
            "read-work",
            "retry-frozen-request",
            "load-server-version",
            "inspect-diagnostics",
            "check-model-config",
            "await-author",
        ]
    ]
    hasUnknownWrite: bool
    artifact: Artifact | None = Field(default=None, exclude_if=is_absent)
    observedHead: ObservedHead | None = Field(default=None, exclude_if=is_absent)


def _artifact(value: Any) -> Artifact | None:
    try:
        return Artifact.model_validate(value)
    except (ValidationError, TypeError, ValueError):
        return None


def _response(
    model: type[BeatCommandResponse] | type[ProseCommandResponse], response: Any
) -> BeatCommandResponse | ProseCommandResponse | None:
    try:
        if not isinstance(response, dict) or response.get("status") != 200:
            return None
        return model.model_validate(response.get("body"))
    except (ValidationError, TypeError, ValueError):
        return None


def _failure(
    model: type[BeatCommandErrorBody] | type[ProseCommandErrorBody], response: Any
) -> BeatCommandErrorBody | ProseCommandErrorBody | None:
    try:
        if not isinstance(response, dict) or response.get("status", 0) < 400:
            return None
        return model.model_validate(response.get("body"))
    except (ValidationError, TypeError, ValueError):
        return None


def _view(work: Any, work_id: str) -> WorkView | None:
    try:
        view = WorkView.model_validate(work)
        return view if view.id == work_id else None
    except (ValidationError, TypeError, ValueError):
        return None


def _candidate(view: WorkView | None, kind: str, chapter: int) -> Artifact | None:
    if view is None:
        return None
    return next(
        (item for item in view.artifacts if item.kind == kind and item.chapter == chapter), None
    )


def _observed(view: WorkView | None, candidate: Artifact | None) -> dict[str, Any]:
    if view is None:
        return {}
    return {
        "observedHead": None
        if candidate is None
        else ObservedHead(
            artifactId=candidate.id, version=candidate.version, humanStatus=candidate.humanStatus
        )
    }


def _confirmed(candidate: Artifact | None, observed: dict[str, Any]) -> Recovery:
    if candidate is None:
        raise ValueError("confirmed recovery requires an artifact")
    return Recovery(
        **observed,
        resolution="confirmed",
        nextActions=["await-author"],
        hasUnknownWrite=False,
        artifact=candidate,
    )


def matches_setting_submission(
    baseline: Artifact, submitted: SettingApproveRequest, candidate: Any
) -> bool:
    original = _artifact(baseline)
    actual = _artifact(candidate)
    if original is None or actual is None:
        return False
    if (
        original.kind != "setting"
        or actual.kind != "setting"
        or original.humanStatus != "pending"
        or actual.humanStatus != "approved"
        or actual.workId != original.workId
        or actual.id != original.id
        or actual.version != original.version
        or submitted.expectedHeadVersion != original.version
        or actual.createdAt != original.createdAt
    ):
        return False
    expected = submitted.content
    content = actual.content
    item_ids = {
        item.itemId
        for section in ("world", "characters", "factions", "relationships")
        for item in getattr(original.content, section)
    }
    item_ids.update(
        item.itemId for section in original.content.extensions for item in section.items
    )
    section_ids = {section.sectionId for section in original.content.extensions}
    original_ids = item_ids | section_ids

    def match_id(requested: str | None, stored: str, allowed: set[str]) -> bool:
        if requested is None:
            return stored not in original_ids
        return requested in allowed and requested == stored

    def match_items(draft: list[Any], result: list[Any]) -> bool:
        return len(draft) == len(result) and all(
            item.title == found.title
            and item.content == found.content
            and match_id(item.itemId, found.itemId, item_ids)
            for item, found in zip(draft, result, strict=True)
        )

    return (
        expected.overview == content.overview
        and all(
            match_items(getattr(expected, section), getattr(content, section))
            for section in ("world", "characters", "factions", "relationships")
        )
        and len(expected.extensions) == len(content.extensions)
        and all(
            section.title == found.title
            and match_id(section.sectionId, found.sectionId, section_ids)
            and match_items(section.items, found.items)
            for section, found in zip(expected.extensions, content.extensions, strict=True)
        )
    )


def matches_beat_submission(
    baseline: Artifact, submitted: BeatApproveRequest, candidate: Any
) -> bool:
    original = _artifact(baseline)
    actual = _artifact(candidate)
    if original is None or actual is None:
        return False
    if (
        original.kind != "beat"
        or actual.kind != "beat"
        or original.humanStatus != "pending"
        or actual.humanStatus != "approved"
        or actual.chapter != original.chapter
        or submitted.chapter != original.chapter
        or actual.workId != original.workId
        or actual.id != original.id
        or actual.version != original.version
        or actual.createdAt != original.createdAt
        or submitted.expectedArtifactId != original.id
        or submitted.expectedHeadVersion != original.version
    ):
        return False
    expected = submitted.content
    ids = {item.itemId for item in original.content.writingPlan}
    return (
        expected.title == actual.content.title
        and expected.goal == actual.content.goal
        and expected.ending == actual.content.ending
        and len(expected.writingPlan) == len(actual.content.writingPlan)
        and all(
            item.title == found.title
            and item.content == found.content
            and (
                found.itemId not in ids and NEW_CARD_ID.fullmatch(found.itemId) is not None
                if item.itemId is None
                else item.itemId in ids and item.itemId == found.itemId
            )
            for item, found in zip(expected.writingPlan, actual.content.writingPlan, strict=True)
        )
    )


def matches_prose_submission(
    baseline: Artifact, submitted: ProseApproveRequest, candidate: Any
) -> bool:
    original = _artifact(baseline)
    actual = _artifact(candidate)
    return (
        original is not None
        and actual is not None
        and original.kind == "prose"
        and actual.kind == "prose"
        and original.humanStatus == "pending"
        and actual.humanStatus == "approved"
        and actual.chapter == original.chapter
        and submitted.chapter == original.chapter
        and actual.workId == original.workId
        and actual.id == original.id
        and actual.version == original.version
        and actual.createdAt == original.createdAt
        and submitted.expectedArtifactId == original.id
        and submitted.expectedHeadVersion == original.version
        and submitted.content.text == actual.content.text
    )


def matches_prose_save(baseline: Artifact, submitted: ProseSaveRequest, candidate: Any) -> bool:
    original = _artifact(baseline)
    actual = _artifact(candidate)
    return (
        original is not None
        and actual is not None
        and original.kind == "prose"
        and actual.kind == "prose"
        and submitted.chapter == original.chapter
        and actual.chapter == original.chapter
        and submitted.expectedArtifactId == original.id
        and submitted.expectedHeadVersion == original.version
        and submitted.expectedHumanStatus == original.humanStatus
        and actual.workId == original.workId
        and actual.id != original.id
        and actual.version == original.version + 1
        and actual.humanStatus == original.humanStatus
        and actual.content.text == submitted.content.text
    )


def recover_submission(
    kind: Literal["beat", "prose"],
    baseline: Artifact,
    operation: str,
    request: Any,
    has_unknown_write: bool,
    response: Any = None,
    work: Any = None,
    work_is_readback: bool = False,
) -> Recovery:
    failure = _failure(BeatCommandErrorBody if kind == "beat" else ProseCommandErrorBody, response)
    command = failure.command if failure is not None else None
    rejected_request = (
        failure is not None
        and command is not None
        and command.kind == "request-rejected"
        and command.operation == operation
        and response["status"] == (413 if failure.code == "payload-too-large" else 400)
    )
    rejected_execution = False
    if failure is not None and command is not None and command.kind == "execution-result":
        expected = command.expectedHead
        rejected_execution = (
            command.operation == operation
            and REJECTION_STATUSES.get(failure.code) == response["status"]
            and command.target.chapter == baseline.chapter
            and request.chapter == baseline.chapter
            and command.target.workId == baseline.workId
            and expected is not None
            and expected.artifactId == request.expectedArtifactId
            and expected.version == request.expectedHeadVersion
            and command.writeOutcome == "not-committed"
            and (
                operation != "save-prose"
                or getattr(expected, "humanStatus", None) == request.expectedHumanStatus
            )
        )
    if baseline.kind != kind or baseline.chapter is None:
        raise ValueError("baseline does not match the submitted artifact kind")
    unknown = has_unknown_write or not (rejected_request or rejected_execution)
    view = _view(work, baseline.workId)
    candidate = _candidate(view, kind, baseline.chapter)
    observed = _observed(view, candidate)
    success = _response(BeatCommandResponse if kind == "beat" else ProseCommandResponse, response)
    if success is not None and success.artifact.kind != kind:
        success = None
    if success is not None and success.command.kind == "execution-result":
        artifact = success.artifact
        result = success.command
        expected = result.expectedHead
        bound = (
            result.operation == operation
            and result.target.chapter == baseline.chapter
            and artifact.chapter == baseline.chapter
            and request.chapter == baseline.chapter
            and result.target.workId == baseline.workId
            and expected is not None
            and expected.artifactId == baseline.id
            and expected.version == baseline.version
            and request.expectedArtifactId == baseline.id
            and request.expectedHeadVersion == baseline.version
            and (
                operation != "save-prose"
                or getattr(expected, "humanStatus", None) == request.expectedHumanStatus
            )
        )
        if operation == "approve-beat":
            matches = matches_beat_submission(baseline, request, artifact)
        elif operation == "approve-prose":
            matches = matches_prose_submission(baseline, request, artifact)
        elif operation == "save-prose":
            matches = matches_prose_save(baseline, request, artifact)
        elif kind == "beat":
            prior_ids = {item.itemId for item in baseline.content.writingPlan}
            matches = all(
                NEW_CARD_ID.fullmatch(item.itemId) is not None and item.itemId not in prior_ids
                for item in artifact.content.writingPlan
            )
        else:
            matches = (
                artifact.humanStatus == "pending"
                and artifact.id != baseline.id
                and artifact.version == baseline.version + 1
            )
        superseded = candidate is not None and (
            candidate.version > artifact.version
            or (
                candidate.version == artifact.version
                and (
                    candidate.id != artifact.id
                    or (candidate.humanStatus == "approved" and artifact.humanStatus == "pending")
                    or (
                        candidate.humanStatus == artifact.humanStatus
                        and candidate.content != artifact.content
                    )
                )
            )
        )
        if bound and matches and not superseded:
            return _confirmed(artifact, observed)

    if operation == "approve-beat" and matches_beat_submission(baseline, request, candidate):
        return _confirmed(candidate, observed)
    if operation == "approve-prose" and matches_prose_submission(baseline, request, candidate):
        return _confirmed(candidate, observed)
    if operation == "save-prose" and matches_prose_save(baseline, request, candidate):
        return _confirmed(candidate, observed)
    if (
        candidate is not None
        and candidate.version >= baseline.version
        and (
            candidate.id != baseline.id
            or candidate.humanStatus != baseline.humanStatus
            or candidate.content != baseline.content
        )
    ):
        return Recovery(
            **observed,
            resolution="conflict",
            nextActions=["read-work", "load-server-version"],
            hasUnknownWrite=unknown,
        )
    if not unknown:
        same_baseline = (
            candidate is not None
            and candidate.id == baseline.id
            and candidate.version == baseline.version
            and candidate.humanStatus == baseline.humanStatus
            and candidate.content == baseline.content
        )
        expected_action = (
            "approve"
            if operation in {"approve-beat", "approve-prose"}
            else "save-draft"
            if operation == "save-prose"
            else "regenerate"
        )
        chapter_view = (
            next(
                (chapter for chapter in view.chapters if chapter.chapter == baseline.chapter), None
            )
            if view is not None
            else None
        )
        allowed = (
            chapter_view.allowedActions
            if chapter_view is not None
            else view.allowedActions
            if view is not None
            else []
        )
        can_edit = (
            rejected_request
            or (failure is not None and failure.code == "invalid-content")
            or (
                work_is_readback
                and same_baseline
                and (
                    kind == "prose"
                    or view is not None
                    and view.workflowState == "awaiting-beat-review"
                )
                and expected_action in allowed
            )
        )
        return Recovery(
            **observed,
            resolution="rejected",
            nextActions=["edit-input"] if can_edit else ["read-work", "inspect-diagnostics"],
            hasUnknownWrite=False,
        )
    return Recovery(
        **observed,
        resolution="uncertain",
        nextActions=["read-work", "retry-frozen-request"],
        hasUnknownWrite=True,
    )
