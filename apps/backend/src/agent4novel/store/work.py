import json
import sqlite3
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from ..contracts import SafeInt, StrictModel, is_absent
from ..domain.requests import WorkCreateRequest
from ..domain.work import (
    AgentConfig,
    Artifact,
    ArtifactInput,
    ArtifactKind,
    HumanStatus,
    Work,
)
from ..errors import KnownError
from ..text import utf16_slice
from .sqlite import SqliteReadStore, _artifact_from_row


def timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class ArtifactHead(StrictModel):
    artifactId: str = Field(min_length=1)
    version: SafeInt
    humanStatus: HumanStatus


class ArtifactPrecondition(StrictModel):
    kind: ArtifactKind
    chapter: SafeInt | None = Field(default=None, exclude_if=is_absent)
    head: ArtifactHead | None


def _json(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_json(item) for item in value]
    if isinstance(value, dict):
        return {key: _json(item) for key, item in value.items()}
    return value


def _dump(value: Any) -> str:
    return json.dumps(_json(value), ensure_ascii=False, separators=(",", ":"))


def _new_work(seed: str, title: str | None = None) -> Work:
    request = WorkCreateRequest.model_validate(
        {"seed": seed, **({"title": title} if title is not None else {})}
    )
    return Work(
        id=f"work-{uuid4()}",
        title=request.title.strip()
        if request.title and request.title.strip()
        else utf16_slice(request.seed, 0, 20),
        seed=request.seed,
        config=AgentConfig(),
        createdAt=timestamp(),
    )


class SqliteStore(SqliteReadStore):
    def create_work(self, seed: str, title: str | None = None) -> Work:
        work = _new_work(seed, title)
        with self._lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._insert_work(work)
                self.db.commit()
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise
        return work

    def _insert_work(self, work: Work) -> None:
        self.db.execute(
            "INSERT INTO works (id, title, seed, config, created_at) VALUES (?, ?, ?, ?, ?)",
            (work.id, work.title, work.seed, _dump(work.config), work.createdAt),
        )

    def create_works_if_empty(self, inputs: list[WorkCreateRequest]) -> bool:
        with self._lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                if self.db.execute("SELECT 1 FROM works LIMIT 1").fetchone() is not None:
                    self.db.rollback()
                    return False
                for request in inputs:
                    self._insert_work(_new_work(request.seed, request.title))
                self.db.commit()
                return True
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise

    def _head(self, work_id: str, kind: ArtifactKind, chapter: int | None) -> sqlite3.Row | None:
        return self.db.execute(
            "SELECT * FROM artifacts WHERE work_id = ? AND kind = ? AND chapter IS ? "
            "ORDER BY version DESC LIMIT 1",
            (work_id, kind, chapter),
        ).fetchone()

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
            row = self._head(work_id, condition.kind, condition.chapter)
            expected = condition.head
            matches = (
                row is None
                if expected is None
                else (
                    row is not None
                    and row["id"] == expected.artifactId
                    and row["version"] == expected.version
                    and row["human_status"] == expected.humanStatus
                )
            )
            if not matches:
                code = (
                    "version-conflict"
                    if condition.kind == kind and condition.chapter == chapter
                    else "upstream-changed"
                )
                raise KnownError(code, f"artifact precondition changed: {work_id}/{condition.kind}")

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
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._require_work(work_id)
                self._check_preconditions(work_id, kind, chapter, preconditions or [])
                row = self._head(work_id, kind, chapter)
                artifact = Artifact.model_validate(
                    {
                        "id": f"artifact-{uuid4()}",
                        "workId": work_id,
                        "kind": kind,
                        **({} if chapter is None else {"chapter": chapter}),
                        "version": (row["version"] if row is not None else 0) + 1,
                        "content": _json(content),
                        "humanStatus": human_status,
                        "createdAt": timestamp(),
                        **(
                            {}
                            if inputs is None
                            else {"inputs": [item.model_dump() for item in inputs]}
                        ),
                    }
                )
                self.db.execute(
                    "INSERT INTO artifacts "
                    "(id, work_id, kind, chapter, version, content, human_status, "
                    "created_at, inputs) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        artifact.id,
                        work_id,
                        kind,
                        chapter,
                        artifact.version,
                        _dump(artifact.content),
                        artifact.humanStatus,
                        artifact.createdAt,
                        None if inputs is None else _dump(inputs),
                    ),
                )
                self.db.commit()
                return artifact
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise

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
        if (kind in {"beat", "prose"}) != (chapter is not None):
            raise ValueError("invalid artifact chapter")
        with self._lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._check_preconditions(work_id, kind, chapter, preconditions or [])
                row = self._head(work_id, kind, chapter)
                if row is None:
                    raise KnownError("artifact-not-found", f"artifact not found: {work_id}/{kind}")
                artifact = Artifact.model_validate(
                    {
                        **_artifact_from_row(row).model_dump(),
                        "humanStatus": status,
                    }
                )
                self.db.execute(
                    "UPDATE artifacts SET human_status = ? WHERE id = ?",
                    (artifact.humanStatus, artifact.id),
                )
                self.db.commit()
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise

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
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._require_work(work_id)
                row = self._head(work_id, kind, chapter)
                if (
                    row is None
                    or row["id"] != expected_artifact_id
                    or row["version"] != expected_head_version
                ):
                    raise KnownError("version-conflict", f"artifact head changed: {work_id}/{kind}")
                head = _artifact_from_row(row)
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
                self.db.execute(
                    "UPDATE artifacts SET content = ?, human_status = ? WHERE id = ?",
                    (_dump(artifact.content), artifact.humanStatus, artifact.id),
                )
                self.db.commit()
                return artifact
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise

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
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._require_work(work_id)
                row = self._head(work_id, kind, chapter)
                if (
                    row is None
                    or row["id"] != expected_artifact_id
                    or row["version"] != expected_head_version
                    or row["human_status"] != expected_human_status
                ):
                    raise KnownError("version-conflict", f"artifact head changed: {work_id}/{kind}")
                head = _artifact_from_row(row)
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
                self.db.execute(
                    "INSERT INTO artifacts "
                    "(id, work_id, kind, chapter, version, content, human_status, "
                    "created_at, inputs) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        artifact.id,
                        work_id,
                        kind,
                        chapter,
                        artifact.version,
                        _dump(artifact.content),
                        artifact.humanStatus,
                        artifact.createdAt,
                        None if head.inputs is None else _dump(head.inputs),
                    ),
                )
                self.db.commit()
                return artifact
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise
