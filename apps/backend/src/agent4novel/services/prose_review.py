from typing import Any

from ..domain.work import Artifact, HumanStatus, WorkDetail
from ..errors import KnownError
from ..store.work import ArtifactHead, ArtifactPrecondition


def prepare_prose_review(
    store: Any,
    work_id: str,
    chapter: int,
    expected_artifact_id: str,
    expected_head_version: int,
    expected_human_status: HumanStatus | None = None,
) -> tuple[WorkDetail, Artifact, list[ArtifactPrecondition]]:
    work = store.get_work(work_id)
    if work is None:
        raise KnownError("work-not-found", "work not found")
    target = next(
        (item for item in work.artifacts if item.kind == "prose" and item.chapter == chapter),
        None,
    )
    if target is None:
        raise KnownError("artifact-not-found", "prose not found")
    if target.id != expected_artifact_id or target.version != expected_head_version:
        raise KnownError("version-conflict", "prose head changed")
    if expected_human_status is not None and target.humanStatus != expected_human_status:
        raise KnownError("version-conflict", "prose review state changed")
    if expected_human_status is None and target.humanStatus != "pending":
        raise KnownError("artifact-already-approved", "prose already approved")
    preconditions = []
    for kind in ("caption", "creative", "outline", "setting", "beat"):
        upstream_chapter = chapter if kind == "beat" else None
        upstream = next(
            (
                item
                for item in work.artifacts
                if item.kind == kind and item.chapter == upstream_chapter
            ),
            None,
        )
        if (
            upstream is None
            or upstream.humanStatus != "approved"
            or (kind == "creative" and len(upstream.content.directions) != 1)
        ):
            raise KnownError("prose-gate-not-ready", "approve the earlier valid gate first")
        preconditions.append(
            ArtifactPrecondition(
                kind=kind,
                **({} if upstream_chapter is None else {"chapter": upstream_chapter}),
                head=ArtifactHead(
                    artifactId=upstream.id,
                    version=upstream.version,
                    humanStatus="approved",
                ),
            )
        )
    return work, target, preconditions
