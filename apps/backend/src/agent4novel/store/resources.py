import hashlib
from typing import Literal

from ..domain.resources import (
    AgentFile,
    AuthorConfigReceipt,
    AuthorConfigSave,
    BadExample,
    BadExampleRequest,
    SettingExtensionActionRequest,
    SettingExtensionProposalRecord,
    SettingExtensionProposeRequest,
    SettingExtensionReceipt,
    matches_bad_example,
)
from ..errors import KnownError
from ..services.setting_extension import (
    act_on_extension,
    extension_receipt,
    propose_extension,
)
from ..text import utf16_slice
from .sqlite import StoreContractError, _artifact_from_row
from .work import SqliteStore, _dump, timestamp


class SqliteResourceStore(SqliteStore):
    def save_author_config(self, work_id: str, request: AuthorConfigSave) -> AuthorConfigReceipt:
        with self._lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._require_work(work_id)
                prior = self.db.execute(
                    "SELECT * FROM author_configs WHERE work_id = ? AND request_id = ?",
                    (work_id, request.requestId),
                ).fetchone()
                if prior is not None:
                    receipt = AuthorConfigReceipt(
                        workId=work_id,
                        revision=prior["revision"],
                        requestId=prior["request_id"],
                        document=prior["document"],
                    )
                    if (
                        prior["expected_revision"] != request.expectedRevision
                        or receipt.document != request.document
                    ):
                        raise KnownError("version-conflict", "request identity already used")
                    return receipt
                current = self.db.execute(
                    "SELECT revision FROM author_configs WHERE work_id = ? "
                    "ORDER BY revision DESC LIMIT 1",
                    (work_id,),
                ).fetchone()
                revision = current["revision"] if current is not None else 0
                if revision != request.expectedRevision:
                    raise KnownError("version-conflict", "configuration revision changed")
                receipt = AuthorConfigReceipt(
                    workId=work_id,
                    revision=revision + 1,
                    requestId=request.requestId,
                    document=request.document,
                )
                self.db.execute(
                    "INSERT INTO author_configs "
                    "(work_id, revision, request_id, expected_revision, document) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        work_id,
                        receipt.revision,
                        request.requestId,
                        request.expectedRevision,
                        _dump(receipt.document),
                    ),
                )
                self.db.commit()
                return receipt
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise
            finally:
                if self.db.in_transaction:
                    self.db.commit()

    def put_agent_file(self, file: AgentFile) -> AgentFile:
        with self._lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._require_work(file.workId)
                existing = self.db.execute(
                    "SELECT metadata FROM agent_files WHERE id = ?", (file.id,)
                ).fetchone()
                if existing is not None:
                    prior = AgentFile.model_validate_json(existing["metadata"])
                    if (
                        prior.workId != file.workId
                        or prior.sha256 != file.sha256
                        or prior.kind != file.kind
                    ):
                        raise KnownError("version-conflict", "file request identity already used")
                    return prior
                if len(self.list_agent_files(file.workId)) >= 64:
                    raise KnownError("config-invalid", "file library limit exceeded")
                self.db.execute(
                    "INSERT INTO agent_files (id, work_id, metadata) VALUES (?, ?, ?)",
                    (file.id, file.workId, _dump(file)),
                )
                self.db.commit()
                return file
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise
            finally:
                if self.db.in_transaction:
                    self.db.commit()

    def _extension_record(
        self, work_id: str, request_id: str
    ) -> SettingExtensionProposalRecord | None:
        record = self.get_setting_extension(work_id, request_id)
        if record is not None and (record.workId != work_id or record.requestId != request_id):
            raise StoreContractError
        return record

    def _put_extension(self, record: SettingExtensionProposalRecord) -> None:
        snapshot = SettingExtensionProposalRecord.model_validate(record)
        self.db.execute(
            "INSERT INTO setting_extension_proposals (work_id, request_id, record) "
            "VALUES (?, ?, ?) ON CONFLICT (work_id, request_id) "
            "DO UPDATE SET record = excluded.record",
            (snapshot.workId, snapshot.requestId, _dump(snapshot)),
        )

    def propose_setting_extension(
        self, work_id: str, request: SettingExtensionProposeRequest
    ) -> SettingExtensionReceipt:
        with self._lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._require_work(work_id)
                work = self.get_work(work_id)
                if work is None:
                    raise StoreContractError
                record = propose_extension(
                    work, request, self._extension_record(work_id, request.requestId)
                )
                self._put_extension(record)
                self.db.commit()
                return extension_receipt(record, "propose")
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise
            finally:
                if self.db.in_transaction:
                    self.db.commit()

    def _act_setting_extension(
        self,
        work_id: str,
        request: SettingExtensionActionRequest,
        operation: Literal["approve", "cancel"],
    ) -> SettingExtensionReceipt:
        if operation not in {"approve", "cancel"}:
            raise ValueError("unsupported extension operation")
        with self._lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._require_work(work_id)
                work = self.get_work(work_id)
                if work is None:
                    raise StoreContractError
                record, artifact = act_on_extension(
                    work,
                    request,
                    self._extension_record(work_id, request.requestId),
                    operation,
                )
                if artifact is not None:
                    self.db.execute(
                        "INSERT INTO artifacts (id, work_id, kind, chapter, version, content, "
                        "human_status, created_at, inputs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            artifact.id,
                            artifact.workId,
                            artifact.kind,
                            artifact.chapter,
                            artifact.version,
                            _dump(artifact.content),
                            artifact.humanStatus,
                            artifact.createdAt,
                            _dump(artifact.inputs),
                        ),
                    )
                self._put_extension(record)
                self.db.commit()
                return extension_receipt(record, operation)
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise
            finally:
                if self.db.in_transaction:
                    self.db.commit()

    def approve_setting_extension(
        self, work_id: str, request: SettingExtensionActionRequest
    ) -> SettingExtensionReceipt:
        return self._act_setting_extension(work_id, request, "approve")

    def cancel_setting_extension(
        self, work_id: str, request: SettingExtensionActionRequest
    ) -> SettingExtensionReceipt:
        return self._act_setting_extension(work_id, request, "cancel")

    def mark_bad_example(self, work_id: str, request: BadExampleRequest) -> BadExample:
        with self._lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self._require_work(work_id)
                prior = self.db.execute(
                    "SELECT * FROM bad_examples WHERE id = ?", (request.requestId,)
                ).fetchone()
                if prior is not None:
                    record = self._bad_example_from_row(prior)
                    if not matches_bad_example(record, work_id, request.model_dump()):
                        raise KnownError("version-conflict", "request identity already used")
                    return record
                row = self.db.execute(
                    "SELECT * FROM artifacts WHERE id = ? AND work_id = ?",
                    (request.sourceArtifactId, work_id),
                ).fetchone()
                artifact = _artifact_from_row(row) if row is not None else None
                if (
                    artifact is None
                    or artifact.kind != "prose"
                    or artifact.chapter != request.chapter
                    or artifact.version != request.sourceVersion
                ):
                    raise KnownError("bad-example-invalid", "selection source does not match")
                text = artifact.content.text
                if (
                    request.end > len(text.encode("utf-16-le", errors="surrogatepass")) // 2
                    or utf16_slice(text, request.start, request.end) != request.text
                    or hashlib.sha256(text.encode()).hexdigest() != request.sourceHash
                ):
                    raise KnownError("bad-example-invalid", "selection source content changed")
                record = BadExample(
                    **request.model_dump(exclude={"requestId"}),
                    id=request.requestId,
                    workId=work_id,
                    createdAt=timestamp(),
                )
                self.db.execute(
                    "INSERT INTO bad_examples (id, work_id, chapter, record, request) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (record.id, work_id, record.chapter, _dump(record), _dump(request)),
                )
                self.db.commit()
                return record
            except Exception:
                if self.db.in_transaction:
                    self.db.rollback()
                raise
            finally:
                if self.db.in_transaction:
                    self.db.commit()
