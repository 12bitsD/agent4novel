import json
import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from ..domain.resources import (
    AgentFile,
    AuthorConfigReceipt,
    BadExample,
    BadExamplePage,
    BadExampleRequest,
    SettingExtensionProposalRecord,
    matches_bad_example,
)
from ..domain.work import Artifact, Work, WorkDetail, WorkSummary
from ..text import utf16_length, utf16_slice

SCHEMA_V1 = [
    (
        "table",
        "works",
        """CREATE TABLE works (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    seed TEXT NOT NULL,
    config TEXT NOT NULL CHECK (json_valid(config)),
    created_at TEXT NOT NULL
  ) STRICT""",
    ),
    (
        "table",
        "artifacts",
        """CREATE TABLE artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    work_id TEXT NOT NULL REFERENCES works(id),
    kind TEXT NOT NULL CHECK (kind IN ('caption','creative','outline','setting','beat','prose')),
    chapter INTEGER,
    version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    content TEXT NOT NULL CHECK (json_valid(content)),
    human_status TEXT NOT NULL CHECK (human_status IN ('pending','approved')),
    created_at TEXT NOT NULL,
    inputs TEXT CHECK (inputs IS NULL OR json_valid(inputs)),
    CHECK (
      (kind IN ('caption','creative','outline','setting') AND chapter IS NULL)
      OR (kind IN ('beat','prose') AND chapter IS NOT NULL
        AND chapter BETWEEN 1 AND 9007199254740991)
    )
  ) STRICT""",
    ),
    (
        "index",
        "artifact_work_version",
        "CREATE UNIQUE INDEX artifact_work_version ON artifacts(work_id, kind, version) "
        "WHERE chapter IS NULL",
    ),
    (
        "index",
        "artifact_chapter_version",
        "CREATE UNIQUE INDEX artifact_chapter_version ON "
        "artifacts(work_id, kind, chapter, version) WHERE chapter IS NOT NULL",
    ),
]
ADDITIONS_V2 = [
    (
        "table",
        "author_configs",
        """CREATE TABLE author_configs (
    work_id TEXT NOT NULL REFERENCES works(id),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    request_id TEXT NOT NULL,
    expected_revision INTEGER NOT NULL,
    document TEXT NOT NULL CHECK (json_valid(document)),
    PRIMARY KEY (work_id, revision), UNIQUE (work_id, request_id)
  ) STRICT""",
    ),
    (
        "table",
        "agent_files",
        """CREATE TABLE agent_files (
    id TEXT PRIMARY KEY NOT NULL,
    work_id TEXT NOT NULL REFERENCES works(id),
    metadata TEXT NOT NULL CHECK (json_valid(metadata))
  ) STRICT""",
    ),
]
ADDITIONS_V3 = [
    (
        "table",
        "bad_examples",
        """CREATE TABLE bad_examples (
    id TEXT PRIMARY KEY NOT NULL,
    work_id TEXT NOT NULL REFERENCES works(id),
    chapter INTEGER NOT NULL CHECK (chapter BETWEEN 1 AND 9007199254740991),
    record TEXT NOT NULL CHECK (json_valid(record)),
    request TEXT NOT NULL CHECK (json_valid(request))
  ) STRICT""",
    ),
    (
        "index",
        "bad_example_work_chapter",
        "CREATE INDEX bad_example_work_chapter ON bad_examples(work_id, chapter)",
    ),
]
ADDITIONS_V4 = [
    (
        "table",
        "setting_extension_proposals",
        """CREATE TABLE setting_extension_proposals (
    work_id TEXT NOT NULL REFERENCES works(id),
    request_id TEXT NOT NULL,
    record TEXT NOT NULL CHECK (json_valid(record)),
    PRIMARY KEY (work_id, request_id)
  ) STRICT""",
    ),
]


class StoreContractError(ValueError):
    code = "invalid-stored-data"


class UnsupportedDatabaseError(ValueError):
    stage = "schema"
    retryable = False


class SqliteInitializationError(ValueError):
    def __init__(self, stage: str, sqlite_code: str | None, attempts: int, retryable: bool) -> None:
        super().__init__("database could not be opened")
        self.stage = stage
        self.sqlite_code = sqlite_code
        self.attempts = attempts
        self.retryable = retryable


def _normalize(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def _expected_schema(version: int) -> list[tuple[str, str, str]]:
    if version == 1:
        return SCHEMA_V1
    if version == 2:
        return [*SCHEMA_V1, *ADDITIONS_V2]
    if version == 3:
        return [*SCHEMA_V1, *ADDITIONS_V2, *ADDITIONS_V3]
    return [*SCHEMA_V1, *ADDITIONS_V2, *ADDITIONS_V3, *ADDITIONS_V4]


def initialize_sqlite_schema(db: sqlite3.Connection) -> None:
    try:
        db.execute("BEGIN IMMEDIATE")
        version = int(db.execute("PRAGMA user_version").fetchone()[0])
        objects = db.execute(
            "SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name"
        ).fetchall()
        if version == 0 and not objects:
            for _type, _name, sql in _expected_schema(4):
                db.execute(sql)
            db.execute("PRAGMA user_version = 4")
            db.commit()
            return
        expected = _expected_schema(version)
        if version not in {1, 2, 3, 4} or len(objects) != len(expected):
            db.rollback()
            raise UnsupportedDatabaseError
        for row in objects:
            matching = next((entry for entry in expected if entry[1] == row["name"]), None)
            if (
                matching is None
                or matching[0] != row["type"]
                or _normalize(matching[2]) != _normalize(row["sql"])
            ):
                db.rollback()
                raise UnsupportedDatabaseError
        if version == 1:
            for _type, _name, sql in ADDITIONS_V2:
                db.execute(sql)
        if version in {1, 2}:
            for _type, _name, sql in ADDITIONS_V3:
                db.execute(sql)
        if version != 4:
            for _type, _name, sql in ADDITIONS_V4:
                db.execute(sql)
            db.execute("PRAGMA user_version = 4")
        db.commit()
    except Exception:
        if db.in_transaction:
            db.rollback()
        raise


TRANSIENT_BUSY_CODES = {
    "SQLITE_BUSY",
    "SQLITE_BUSY_RECOVERY",
    "SQLITE_BUSY_SNAPSHOT",
    "SQLITE_BUSY_TIMEOUT",
}
SQLITE_CODE_NAMES = {
    sqlite3.SQLITE_BUSY: "SQLITE_BUSY",
    sqlite3.SQLITE_BUSY_RECOVERY: "SQLITE_BUSY_RECOVERY",
    sqlite3.SQLITE_BUSY_SNAPSHOT: "SQLITE_BUSY_SNAPSHOT",
    sqlite3.SQLITE_BUSY_TIMEOUT: "SQLITE_BUSY_TIMEOUT",
    sqlite3.SQLITE_LOCKED: "SQLITE_LOCKED",
}


def _sqlite_error_code(error: sqlite3.Error) -> str | None:
    code = getattr(error, "sqlite_errorcode", None)
    if isinstance(code, str):
        return code
    if isinstance(code, int):
        return SQLITE_CODE_NAMES.get(code, str(code))
    return None


def initialize_sqlite_database(
    db: sqlite3.Connection, max_attempts: int = 8, memory: bool = False
) -> None:
    max_attempts = max(1, min(20, max_attempts))
    busy_timeout = int(db.execute("PRAGMA busy_timeout").fetchone()[0])
    try:
        for attempt in range(1, max_attempts + 1):
            stage = "foreign_keys"
            try:
                db.execute("PRAGMA busy_timeout = 100")
                db.execute("PRAGMA foreign_keys = ON")
                stage = "schema"
                initialize_sqlite_schema(db)
                stage = "wal"
                if not memory:
                    journal = db.execute("PRAGMA journal_mode = WAL").fetchone()[0]
                    if str(journal).lower() != "wal":
                        raise SqliteInitializationError(stage, None, attempt, False)
                stage = "synchronous"
                db.execute("PRAGMA synchronous = FULL")
                if int(db.execute("PRAGMA synchronous").fetchone()[0]) != 2:
                    raise SqliteInitializationError(stage, None, attempt, False)
                db.execute("PRAGMA busy_timeout = 5000")
                return
            except sqlite3.Error as error:
                code = _sqlite_error_code(error)
                retryable = code in TRANSIENT_BUSY_CODES
                if not retryable or attempt == max_attempts:
                    raise SqliteInitializationError(stage, code, attempt, retryable) from error
                time.sleep(0.01)
    finally:
        db.execute(f"PRAGMA busy_timeout = {busy_timeout}")


def _parse_json(value: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError as error:
        raise StoreContractError from error


def _validated(value: Any, model: Any) -> Any:
    try:
        return model.model_validate(value)
    except (ValueError, TypeError) as error:
        raise StoreContractError from error


def _work_from_row(row: sqlite3.Row) -> Work:
    return _validated(
        {
            "id": row["id"],
            "title": row["title"],
            "seed": row["seed"],
            "config": _parse_json(row["config"]),
            "createdAt": row["created_at"],
        },
        Work,
    )


def _artifact_from_row(row: sqlite3.Row) -> Artifact:
    return _validated(
        {
            "id": row["id"],
            "workId": row["work_id"],
            "kind": row["kind"],
            **({} if row["chapter"] is None else {"chapter": row["chapter"]}),
            "version": row["version"],
            "content": _parse_json(row["content"]),
            "humanStatus": row["human_status"],
            "createdAt": row["created_at"],
            **({} if row["inputs"] is None else {"inputs": _parse_json(row["inputs"])}),
        },
        Artifact,
    )


class SqliteReadStore:
    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        self._lock = threading.RLock()
        try:
            if self.path != ":memory:":
                Path(self.path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                try:
                    descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
                    os.close(descriptor)
                except FileExistsError:
                    pass
            self.db = sqlite3.connect(self.path, timeout=5.0, check_same_thread=False)
            self.db.row_factory = sqlite3.Row
            initialize_sqlite_database(self.db, memory=self.path == ":memory:")
            self.db.execute("PRAGMA busy_timeout = 5000")
        except Exception as error:
            if isinstance(error, (UnsupportedDatabaseError, SqliteInitializationError)):
                raise
            raise SqliteInitializationError("open", None, 1, False) from error

    def close(self) -> None:
        self.db.close()

    def _read_work(self, work_id: str) -> Work | None:
        row = self.db.execute("SELECT * FROM works WHERE id = ?", (work_id,)).fetchone()
        return _work_from_row(row) if row is not None else None

    def get_work(self, work_id: str) -> WorkDetail | None:
        with self._lock:
            work = self._read_work(work_id)
            if work is None:
                return None
            rows = self.db.execute(
                """SELECT a.* FROM artifacts a
                WHERE a.work_id = ? AND NOT EXISTS (
                  SELECT 1 FROM artifacts newer WHERE newer.work_id = a.work_id
                    AND newer.kind = a.kind
                    AND newer.chapter IS a.chapter AND newer.version > a.version
                ) ORDER BY (SELECT MIN(first.rowid) FROM artifacts first
                  WHERE first.work_id = a.work_id AND first.kind = a.kind
                    AND first.chapter IS a.chapter)""",
                (work_id,),
            ).fetchall()
            return _validated(
                {
                    **work.model_dump(),
                    "artifacts": [_artifact_from_row(row) for row in rows],
                },
                WorkDetail,
            )

    def list_works(self) -> list[WorkSummary]:
        with self._lock:
            rows = self.db.execute("SELECT id FROM works ORDER BY rowid").fetchall()
            summaries = []
            for row in rows:
                work = self.get_work(row["id"])
                if work is None:
                    raise StoreContractError
                summaries.append(
                    WorkSummary(
                        id=work.id,
                        title=work.title,
                        seedPreview=utf16_slice(work.seed, 0, 40) + "…"
                        if utf16_length(work.seed) > 40
                        else work.seed,
                        chapterCount=sum(
                            artifact.kind == "prose" and artifact.humanStatus == "approved"
                            for artifact in work.artifacts
                        ),
                    )
                )
            return summaries

    def get_artifact_version(
        self, work_id: str, kind: str, chapter: int | None, artifact_id: str, version: int
    ) -> Artifact | None:
        with self._lock:
            row = self.db.execute(
                "SELECT * FROM artifacts WHERE work_id = ? AND kind = ? "
                "AND chapter IS ? AND id = ? AND version = ?",
                (work_id, kind, chapter, artifact_id, version),
            ).fetchone()
            return _artifact_from_row(row) if row is not None else None

    def _require_work(self, work_id: str) -> None:
        if self._read_work(work_id) is None:
            raise WorkNotFoundError

    def get_author_config(self, work_id: str) -> Any:
        with self._lock:
            self._require_work(work_id)
            row = self.db.execute(
                "SELECT * FROM author_configs WHERE work_id = ? ORDER BY revision DESC LIMIT 1",
                (work_id,),
            ).fetchone()
            if row is None:
                return None
            return _validated(
                {
                    "workId": work_id,
                    "revision": row["revision"],
                    "requestId": row["request_id"],
                    "document": _parse_json(row["document"]),
                },
                AuthorConfigReceipt,
            )

    def get_author_config_receipt(self, work_id: str, request_id: str) -> Any:
        with self._lock:
            self._require_work(work_id)
            row = self.db.execute(
                "SELECT * FROM author_configs WHERE work_id = ? AND request_id = ?",
                (work_id, request_id),
            ).fetchone()
            if row is None:
                return None
            return _validated(
                {
                    "workId": work_id,
                    "requestId": request_id,
                    "revision": row["revision"],
                    "document": _parse_json(row["document"]),
                },
                AuthorConfigReceipt,
            )

    def list_agent_files(self, work_id: str) -> list[Any]:
        with self._lock:
            self._require_work(work_id)
            rows = self.db.execute(
                "SELECT * FROM agent_files WHERE work_id = ? ORDER BY rowid", (work_id,)
            ).fetchall()
            files = []
            for row in rows:
                file = _validated(_parse_json(row["metadata"]), AgentFile)
                if file.id != row["id"] or file.workId != row["work_id"]:
                    raise StoreContractError
                files.append(file)
            return files

    def get_setting_extension(self, work_id: str, request_id: str) -> Any:
        with self._lock:
            self._require_work(work_id)
            row = self.db.execute(
                "SELECT record FROM setting_extension_proposals "
                "WHERE work_id = ? AND request_id = ?",
                (work_id, request_id),
            ).fetchone()
            if row is None:
                return None
            return _validated(_parse_json(row["record"]), SettingExtensionProposalRecord)

    @staticmethod
    def _bad_example_from_row(row: sqlite3.Row) -> BadExample:
        record = _validated(_parse_json(row["record"]), BadExample)
        request = _validated(_parse_json(row["request"]), BadExampleRequest)
        if (
            record.id != row["id"]
            or record.workId != row["work_id"]
            or record.chapter != row["chapter"]
            or not matches_bad_example(record, row["work_id"], request.model_dump())
        ):
            raise StoreContractError
        return record

    def get_bad_example(self, work_id: str, sample_id: str) -> Any:
        with self._lock:
            self._require_work(work_id)
            row = self.db.execute(
                "SELECT * FROM bad_examples WHERE id = ? AND work_id = ?",
                (sample_id, work_id),
            ).fetchone()
            return self._bad_example_from_row(row) if row is not None else None

    def list_bad_examples(
        self, work_id: str, chapter: int | None = None, after: int | None = None
    ) -> Any:
        with self._lock:
            self._require_work(work_id)
            rows = self.db.execute(
                "SELECT *, rowid AS cursor FROM bad_examples WHERE work_id = ? "
                "AND (? IS NULL OR chapter = ?) AND rowid > ? ORDER BY rowid LIMIT ?",
                (work_id, chapter, chapter, after or 0, 51),
            ).fetchall()
            page = rows[:50]
            return _validated(
                {
                    "workId": work_id,
                    **({} if chapter is None else {"chapter": chapter}),
                    **({} if after is None else {"after": after}),
                    "items": [self._bad_example_from_row(row) for row in page],
                    **({"nextCursor": page[-1]["cursor"]} if len(rows) > 50 else {}),
                },
                BadExamplePage,
            )


class WorkNotFoundError(ValueError):
    code = "work-not-found"
