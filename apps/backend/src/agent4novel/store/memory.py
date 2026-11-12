import copy
import hashlib
import threading
from typing import Any
from uuid import uuid4

from pydantic import BaseModel

from ..domain.requests import WorkCreateRequest
from ..domain.resources import BadExample, BadExampleRequest, matches_bad_example
from ..domain.work import (
    Artifact,
    ArtifactInput,
    ArtifactKind,
    HumanStatus,
    Work,
    WorkDetail,
    WorkSummary,
)
from ..errors import KnownError
from ..services.setting_extension import (
    act_on_extension,
    extension_receipt,
    propose_extension,
)
from ..text import utf16_length, utf16_slice
from .work import ArtifactPrecondition, _new_work, timestamp


def _clone(value: Any) -> Any:
    return copy.deepcopy(value)


def _json(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_json(item) for item in value]
    if isinstance(value, dict):
        return {key: _json(item) for key, item in value.items()}
    return value


class InMemoryStore:
    def __init__(self) -> None:
        self._works: dict[str, WorkDetail] = {}
        self._history: dict[tuple[str, str, int | None], list[Artifact]] = {}
        self._extensions: dict[tuple[str, str], Any] = {}
        self._bad_examples: dict[str, Any] = {}
        self._lock = threading.RLock()

    def close(self) -> None:
        return

    def create_work(self, seed: str, title: str | None = None) -> Work:
        work = WorkDetail(
            **_new_work(seed, title).model_dump(),
            artifacts=[],
        )
        with self._lock:
            self._works[work.id] = _clone(work)
        return _clone(work)

    def create_works_if_empty(self, inputs: list[WorkCreateRequest]) -> bool:
        with self._lock:
            if self._works:
                return False
            staged = {}
            for request in inputs:
                work = WorkDetail(
                    **_new_work(request.seed, request.title).model_dump(),
                    artifacts=[],
                )
                staged[work.id] = work
            self._works = {**self._works, **staged}
            return True

    def get_work(self, work_id: str) -> WorkDetail | None:
        with self._lock:
            work = self._works.get(work_id)
            return _clone(work) if work is not None else None

    def list_works(self) -> list[WorkSummary]:
        with self._lock:
            return [
                WorkSummary(
                    id=work.id,
                    title=work.title,
                    seedPreview=f"{utf16_slice(work.seed, 0, 40)}…"
                    if utf16_length(work.seed) > 40
                    else work.seed,
                    chapterCount=sum(
                        artifact.kind == "prose" and artifact.humanStatus == "approved"
                        for artifact in work.artifacts
                    ),
                )
                for work in self._works.values()
            ]

    def _require_work(self, work_id: str) -> None:
        if work_id not in self._works:
            raise KnownError("work-not-found", f"work not found: {work_id}")

    def _bucket(self, work_id: str, kind: ArtifactKind, chapter: int | None) -> list[Artifact]:
        return self._history.setdefault((work_id, kind, chapter), [])

    def _head(self, work_id: str, kind: ArtifactKind, chapter: int | None) -> Artifact | None:
        bucket = self._history.get((work_id, kind, chapter), [])
        return bucket[-1] if bucket else None

    def get_artifact_version(
        self,
        work_id: str,
        kind: ArtifactKind,
        chapter: int | None,
        artifact_id: str,
        version: int,
    ) -> Artifact | None:
        with self._lock:
            artifact = next(
                (
                    item
                    for item in self._history.get((work_id, kind, chapter), [])
                    if item.id == artifact_id and item.version == version
                ),
                None,
            )
            return _clone(artifact) if artifact is not None else None

    def _check_preconditions(
        self,
        work_id: str,
        kind: ArtifactKind,
        chapter: int | None,
        preconditions: list[ArtifactPrecondition],
    ) -> None:
        for condition in preconditions:
            if (condition.kind in {"beat", "prose"}) != (condition.chapter is not None):
                raise ValueError("invalid precondition chapter")
            head = self._head(work_id, condition.kind, condition.chapter)
            expected = condition.head
            matches = (
                head is None
                if expected is None
                else (
                    head is not None
                    and head.id == expected.artifactId
                    and head.version == expected.version
                    and head.humanStatus == expected.humanStatus
                )
            )
            if not matches:
                code = (
                    "version-conflict"
                    if condition.kind == kind and condition.chapter == chapter
                    else "upstream-changed"
                )
                raise KnownError(code, f"artifact precondition changed: {work_id}/{condition.kind}")

    def _publish(self, artifact: Artifact) -> Artifact:
        bucket = self._bucket(artifact.workId, artifact.kind, artifact.chapter)
        bucket.append(_clone(artifact))
        work = self._works[artifact.workId]
        address = (artifact.kind, artifact.chapter)
        for index, item in enumerate(work.artifacts):
            if (item.kind, item.chapter) == address:
                work.artifacts[index] = _clone(artifact)
                break
        else:
            work.artifacts.append(_clone(artifact))
        return _clone(artifact)

    def append_artifact(
        self,
        work_id: str,
        kind: ArtifactKind,
        content: Any,
        *,
        chapter: int | None = None,
        human_status: HumanStatus = "pending",
        inputs: list[ArtifactInput] | None = None,
        preconditions: list[ArtifactPrecondition] | None = None,
    ) -> Artifact:
        if (kind in {"beat", "prose"}) != (chapter is not None):
            raise ValueError("invalid artifact chapter")
        if human_status == "approved" and kind in {"beat", "prose", "setting"}:
            raise KnownError(
                f"{kind}-approval-required", f"{kind} requires the dedicated finalization command"
            )
        with self._lock:
            self._require_work(work_id)
            self._check_preconditions(work_id, kind, chapter, preconditions or [])
            head = self._head(work_id, kind, chapter)
            artifact = Artifact.model_validate(
                {
                    "id": f"artifact-{uuid4()}",
                    "workId": work_id,
                    "kind": kind,
                    **({} if chapter is None else {"chapter": chapter}),
                    "version": (head.version if head else 0) + 1,
                    "content": _json(content),
                    "humanStatus": human_status,
                    "createdAt": timestamp(),
                    **(
                        {} if inputs is None else {"inputs": [item.model_dump() for item in inputs]}
                    ),
                }
            )
            return self._publish(artifact)

    def set_status(
        self,
        work_id: str,
        kind: ArtifactKind,
        status: HumanStatus,
        *,
        chapter: int | None = None,
        preconditions: list[ArtifactPrecondition] | None = None,
    ) -> None:
        if kind in {"beat", "prose", "setting"}:
            raise KnownError(
                f"{kind}-approval-required", f"{kind} requires the dedicated finalization command"
            )
        with self._lock:
            self._check_preconditions(work_id, kind, chapter, preconditions or [])
            head = self._head(work_id, kind, chapter)
            if head is None:
                raise KnownError("artifact-not-found", f"artifact not found: {work_id}/{kind}")
            artifact = Artifact.model_validate({**head.model_dump(), "humanStatus": status})
            bucket = self._bucket(work_id, kind, chapter)
            bucket[-1] = _clone(artifact)
            self._works[work_id].artifacts = [
                item if item.id != artifact.id else _clone(artifact)
                for item in self._works[work_id].artifacts
            ]

    def finalize_artifact(
        self,
        work_id: str,
        kind: ArtifactKind,
        *,
        chapter: int | None,
        expected_artifact_id: str,
        expected_head_version: int,
        content: Any,
        preconditions: list[ArtifactPrecondition] | None = None,
    ) -> Artifact:
        if (kind in {"beat", "prose"}) != (chapter is not None):
            raise ValueError("invalid artifact chapter")
        with self._lock:
            self._require_work(work_id)
            head = self._head(work_id, kind, chapter)
            if (
                head is None
                or head.id != expected_artifact_id
                or head.version != expected_head_version
            ):
                raise KnownError("version-conflict", f"artifact head changed: {work_id}/{kind}")
            if head.humanStatus == "approved":
                raise KnownError(
                    "artifact-already-approved", f"artifact already approved: {work_id}/{kind}"
                )
            self._check_preconditions(work_id, kind, chapter, preconditions or [])
            artifact = Artifact.model_validate(
                {
                    **head.model_dump(),
                    "content": _json(content),
                    "humanStatus": "approved",
                }
            )
            bucket = self._bucket(work_id, kind, chapter)
            bucket[-1] = _clone(artifact)
            self._works[work_id].artifacts = [
                item if item.id != artifact.id else _clone(artifact)
                for item in self._works[work_id].artifacts
            ]
            return _clone(artifact)

    def save_artifact(
        self,
        work_id: str,
        kind: ArtifactKind,
        *,
        chapter: int | None,
        expected_artifact_id: str,
        expected_head_version: int,
        expected_human_status: HumanStatus,
        content: Any,
        preconditions: list[ArtifactPrecondition] | None = None,
    ) -> Artifact:
        if (kind in {"beat", "prose"}) != (chapter is not None):
            raise ValueError("invalid artifact chapter")
        with self._lock:
            self._require_work(work_id)
            head = self._head(work_id, kind, chapter)
            if (
                head is None
                or head.id != expected_artifact_id
                or head.version != expected_head_version
                or head.humanStatus != expected_human_status
            ):
                raise KnownError("version-conflict", f"artifact head changed: {work_id}/{kind}")
            self._check_preconditions(work_id, kind, chapter, preconditions or [])
            artifact = Artifact.model_validate(
                {
                    **head.model_dump(),
                    "id": f"artifact-{uuid4()}",
                    "version": head.version + 1,
                    "content": _json(content),
                    "createdAt": timestamp(),
                }
            )
            return self._publish(artifact)

    def get_author_config(self, work_id: str) -> None:
        self._require_work(work_id)
        return None

    def get_author_config_receipt(self, work_id: str, request_id: str) -> None:
        self._require_work(work_id)
        return None

    def list_agent_files(self, work_id: str) -> list[Any]:
        self._require_work(work_id)
        return []

    def get_setting_extension(self, work_id: str, request_id: str) -> Any:
        with self._lock:
            self._require_work(work_id)
            return _clone(self._extensions.get((work_id, request_id)))

    def propose_setting_extension(self, work_id: str, request: Any) -> Any:
        with self._lock:
            self._require_work(work_id)
            work = self._works[work_id]
            record = propose_extension(
                work, request, self._extensions.get((work_id, request.requestId))
            )
            self._extensions[(work_id, request.requestId)] = _clone(record)
            return extension_receipt(record, "propose")

    def _act_setting_extension(self, work_id: str, request: Any, operation: Any) -> Any:
        with self._lock:
            self._require_work(work_id)
            record, artifact = act_on_extension(
                self._works[work_id],
                request,
                self._extensions.get((work_id, request.requestId)),
                operation,
            )
            if artifact is not None:
                self._publish(artifact)
            self._extensions[(work_id, request.requestId)] = _clone(record)
            return extension_receipt(record, operation)

    def approve_setting_extension(self, work_id: str, request: Any) -> Any:
        return self._act_setting_extension(work_id, request, "approve")

    def cancel_setting_extension(self, work_id: str, request: Any) -> Any:
        return self._act_setting_extension(work_id, request, "cancel")

    def mark_bad_example(self, work_id: str, request: BadExampleRequest) -> BadExample:
        with self._lock:
            self._require_work(work_id)
            prior = self._bad_examples.get(request.requestId)
            if prior is not None:
                if not matches_bad_example(prior, work_id, request.model_dump()):
                    raise KnownError("version-conflict", "request identity already used")
                return _clone(prior)
            artifact = self.get_artifact_version(
                work_id,
                "prose",
                request.chapter,
                request.sourceArtifactId,
                request.sourceVersion,
            )
            if artifact is None:
                raise KnownError("bad-example-invalid", "selection source does not match")
            text = artifact.content.text
            if (
                utf16_slice(text, request.start, request.end) != request.text
                or hashlib.sha256(text.encode()).hexdigest() != request.sourceHash
            ):
                raise KnownError("bad-example-invalid", "selection source content changed")
            record = BadExample(
                **request.model_dump(exclude={"requestId"}),
                id=request.requestId,
                workId=work_id,
                createdAt=timestamp(),
            )
            self._bad_examples[record.id] = record
            return _clone(record)

    def get_bad_example(self, work_id: str, sample_id: str) -> Any:
        with self._lock:
            self._require_work(work_id)
            record = self._bad_examples.get(sample_id)
            return _clone(record) if record is not None and record.workId == work_id else None

    def list_bad_examples(
        self, work_id: str, chapter: int | None = None, after: int | None = None
    ) -> Any:
        from ..domain.resources import BadExamplePage

        with self._lock:
            self._require_work(work_id)
            records = [
                item
                for item in self._bad_examples.values()
                if item.workId == work_id and (chapter is None or item.chapter == chapter)
            ]
            start = after or 0
            page = records[start : start + 50]
            return BadExamplePage(
                workId=work_id,
                **({} if chapter is None else {"chapter": chapter}),
                **({} if after is None else {"after": after}),
                items=_clone(page),
                **({"nextCursor": start + 50} if len(records) > start + 50 else {}),
            )
