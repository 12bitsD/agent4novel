from typing import Any, Literal
from uuid import uuid4

from ..domain.resources import (
    ArtifactRef,
    ExistingSettingExtensionResource,
    NoneSettingExtensionResource,
    PersistedSettingExtensionRequest,
    SettingExtension,
    SettingExtensionActionRequest,
    SettingExtensionImpact,
    SettingExtensionProposalRecord,
    SettingExtensionProposalRef,
    SettingExtensionProposeRequest,
    SettingExtensionReceipt,
)
from ..domain.work import Artifact, ArtifactInput, SettingContent, WorkDetail
from ..errors import KnownError
from ..store.work import timestamp


def ref_of(artifact: Artifact) -> ArtifactRef:
    return ArtifactRef(artifactId=artifact.id, version=artifact.version)


def same_ref(a: ArtifactRef | ArtifactInput, b: ArtifactRef) -> bool:
    return a.artifactId == b.artifactId and a.version == b.version


def _setting_head(work: WorkDetail) -> Artifact | None:
    return next((artifact for artifact in work.artifacts if artifact.kind == "setting"), None)


def _has_pending_chapter(work: WorkDetail) -> bool:
    return any(
        artifact.kind in {"beat", "prose"} and artifact.humanStatus == "pending"
        for artifact in work.artifacts
    )


def is_valid_approved_extension_candidate(
    record: SettingExtensionProposalRecord, candidate: Artifact | None
) -> bool:
    if record.status != "approved":
        return True
    if record.candidate is None or candidate is None:
        return False
    if (
        candidate.workId != record.workId
        or candidate.kind != "setting"
        or candidate.chapter is not None
        or candidate.humanStatus != "approved"
        or not same_ref(record.candidate, ref_of(candidate))
    ):
        return False
    if not any(
        extension.model_dump() == record.extension.model_dump()
        for extension in candidate.content.extensions
    ):
        return False
    return any(
        ref.kind == "setting" and same_ref(ref, record.expectedBase)
        for ref in candidate.inputs or []
    )


def extension_resource(
    work: WorkDetail, request_id: str, record: SettingExtensionProposalRecord | None
) -> Any:
    approved = {
        artifact.chapter
        for artifact in work.artifacts
        if artifact.kind == "prose" and artifact.humanStatus == "approved"
    }
    pending = {
        artifact.chapter
        for artifact in work.artifacts
        if artifact.kind in {"beat", "prose"} and artifact.humanStatus == "pending"
    }
    impact = SettingExtensionImpact(
        observedAt=timestamp(),
        approvedChapterCount=len(approved),
        pendingChapterCount=len(pending),
        continuityWarning=len(approved) > 0,
    )
    if record is None:
        return NoneSettingExtensionResource(workId=work.id, requestId=request_id, impact=impact)
    head = _setting_head(work)
    stale = record.status == "pending" and (
        head is None
        or head.humanStatus != "approved"
        or not same_ref(ref_of(head), record.expectedBase)
    )
    return ExistingSettingExtensionResource(
        workId=work.id,
        requestId=request_id,
        status="stale" if stale else record.status,
        impact=impact,
        proposal=SettingExtensionProposalRef(workId=work.id, requestId=request_id),
        base=record.expectedBase,
        extension=record.extension,
        candidate=record.candidate,
        createdAt=record.createdAt,
        updatedAt=record.updatedAt,
    )


def extension_receipt(
    record: SettingExtensionProposalRecord, operation: Literal["propose", "approve", "cancel"]
) -> SettingExtensionReceipt:
    return SettingExtensionReceipt(
        requestId=record.requestId,
        workId=record.workId,
        operation=operation,
        outcome="success",
        writeOutcome="committed",
        proposal=SettingExtensionProposalRef(workId=record.workId, requestId=record.requestId),
        candidate=record.candidate if operation == "approve" else None,
        errorCode=None,
    )


def propose_extension(
    work: WorkDetail,
    request: SettingExtensionProposeRequest,
    prior: SettingExtensionProposalRecord | None,
) -> SettingExtensionProposalRecord:
    persisted = PersistedSettingExtensionRequest(**request.model_dump(), workId=work.id)
    if prior is not None:
        if prior.request != persisted:
            raise KnownError("setting-extension-request-conflict", "request identity already used")
        return prior
    head = _setting_head(work)
    if (
        head is None
        or head.humanStatus != "approved"
        or not same_ref(ref_of(head), request.expectedBase)
    ):
        raise KnownError(
            "setting-extension-base-conflict", "setting base is not the current approved head"
        )
    if _has_pending_chapter(work):
        raise KnownError("setting-extension-chapter-pending", "a chapter is pending review")
    baseline = SettingContent.model_validate(head.content)
    used = {
        item.itemId
        for item in [
            *baseline.world,
            *baseline.characters,
            *baseline.factions,
            *baseline.relationships,
            *[item for section in baseline.extensions for item in section.items],
        ]
    }
    used.update(section.sectionId for section in baseline.extensions)

    def new_id(prefix: str) -> str:
        while True:
            value = f"{prefix}-{uuid4()}"
            if value not in used:
                used.add(value)
                return value

    extension = SettingExtension.model_validate(
        {
            "sectionId": new_id("section"),
            "title": request.extension.title,
            "items": [
                {**item.model_dump(), "itemId": new_id("item")} for item in request.extension.items
            ],
        }
    )
    try:
        SettingContent.model_validate(
            {**baseline.model_dump(), "extensions": [*baseline.extensions, extension]}
        )
    except ValueError as error:
        raise KnownError(
            "setting-extension-limit", "merged setting exceeds logical limits"
        ) from error
    now = timestamp()
    return SettingExtensionProposalRecord(
        workId=work.id,
        requestId=request.requestId,
        expectedBase=request.expectedBase,
        request=persisted,
        extension=extension,
        status="pending",
        candidate=None,
        createdAt=now,
        updatedAt=now,
    )


def act_on_extension(
    work: WorkDetail,
    request: SettingExtensionActionRequest,
    record: SettingExtensionProposalRecord | None,
    operation: Literal["approve", "cancel"],
) -> tuple[SettingExtensionProposalRecord, Artifact | None]:
    if record is None:
        raise KnownError("setting-extension-not-found", "setting extension not found")
    if not same_ref(record.expectedBase, request.expectedBase):
        raise KnownError("setting-extension-stale", "proposal base does not match")
    terminal = "approved" if operation == "approve" else "cancelled"
    if record.status == terminal:
        return record, None
    if record.status != "pending":
        raise KnownError("setting-extension-state-conflict", "proposal is already terminal")
    if operation == "cancel":
        return record.model_copy(update={"status": "cancelled", "updatedAt": timestamp()}), None
    head = _setting_head(work)
    if (
        head is None
        or head.humanStatus != "approved"
        or not same_ref(ref_of(head), record.expectedBase)
    ):
        raise KnownError("setting-extension-stale", "setting base changed")
    if _has_pending_chapter(work):
        raise KnownError("setting-extension-chapter-pending", "a chapter is pending review")
    baseline = SettingContent.model_validate(head.content)
    try:
        merged = SettingContent.model_validate(
            {**baseline.model_dump(), "extensions": [*baseline.extensions, record.extension]}
        )
    except ValueError as error:
        raise KnownError(
            "setting-extension-invalid", "invalid append-only setting extension"
        ) from error
    artifact = Artifact.model_validate(
        {
            "id": f"artifact-{uuid4()}",
            "workId": work.id,
            "kind": "setting",
            "version": head.version + 1,
            "content": merged,
            "humanStatus": "approved",
            "createdAt": timestamp(),
            "inputs": [{"kind": "setting", **record.expectedBase.model_dump()}],
        }
    )
    updated = record.model_copy(
        update={"status": "approved", "candidate": ref_of(artifact), "updatedAt": timestamp()}
    )
    return updated, artifact
