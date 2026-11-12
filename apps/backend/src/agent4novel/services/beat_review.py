from typing import Any

from ..domain.work import Artifact, WorkDetail
from ..errors import KnownError
from ..store.work import ArtifactHead, ArtifactPrecondition


def prepare_beat_review(
    store: Any,
    work_id: str,
    chapter: int,
    expected_artifact_id: str,
    expected_head_version: int,
) -> tuple[WorkDetail, Artifact, list[ArtifactPrecondition]]:
    work = store.get_work(work_id)
    if work is None:
        raise KnownError("work-not-found", "work not found")
    target = next(
        (item for item in work.artifacts if item.kind == "beat" and item.chapter == chapter),
        None,
    )
    if target is None:
        raise KnownError("beat-gate-not-ready", "beat gate not ready")
    if target.id != expected_artifact_id or target.version != expected_head_version:
        raise KnownError("version-conflict", "beat head changed")
    if target.humanStatus != "pending":
        raise KnownError("artifact-already-approved", "beat already approved")
    preconditions = []
    for kind in ("caption", "creative", "outline", "setting"):
        upstream = next(
            (item for item in work.artifacts if item.kind == kind and item.chapter is None),
            None,
        )
        if (
            upstream is None
            or upstream.humanStatus != "approved"
            or (kind == "creative" and len(upstream.content.directions) != 1)
        ):
            raise KnownError("beat-gate-not-ready", "approve the earlier valid gate first")
        preconditions.append(
            ArtifactPrecondition(
                kind=kind,
                head=ArtifactHead(
                    artifactId=upstream.id,
                    version=upstream.version,
                    humanStatus="approved",
                ),
            )
        )
    return work, target, preconditions
