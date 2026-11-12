import hashlib
from typing import Any

from ..domain.resources import AgentFile, AgentFileUpload, AuthorConfigReceipt, AuthorConfigSave
from ..errors import ConfigInvalidError, KnownError
from ..store.sqlite import WorkNotFoundError
from ..store.work import timestamp
from .author_config import AuthorConfigService
from .skill_files import parse_skill_text, publish_agent_file, read_agent_file


class AuthorWriteService(AuthorConfigService):
    def save(self, work_id: str, value: Any) -> AuthorConfigReceipt:
        request = AuthorConfigSave.model_validate(value)
        prior = self.store.get_author_config_receipt(work_id, request.requestId)
        if prior is not None:
            if prior.revision != request.expectedRevision + 1 or prior.document != request.document:
                raise KnownError("version-conflict", "request identity already used")
            return prior
        work = self.store.get_work(work_id)
        if work is None:
            raise WorkNotFoundError
        self.resolve(work, request.document, request.expectedRevision + 1)
        return self.store.save_author_config(work_id, request)

    def upload(self, work_id: str, value: Any) -> AgentFile:
        request = AgentFileUpload.model_validate(value)
        text = (
            f"---\nname: author-prompt\ndescription: Author writing guidance\n---\n{request.text}"
            if request.kind == "prompt"
            else request.text
        )
        metadata = parse_skill_text(text)
        file = AgentFile(
            id=request.requestId,
            workId=work_id,
            kind=request.kind,
            name=metadata.name,
            description=metadata.description,
            sha256=hashlib.sha256(text.encode()).hexdigest(),
            byteLength=len(text.encode()),
            createdAt=timestamp(),
        )
        if self.data_dir is None:
            raise ConfigInvalidError
        files = self.store.list_agent_files(work_id)
        old = next((item for item in files if item.id == file.id), None)
        if old is not None:
            if old.sha256 != file.sha256 or old.kind != file.kind:
                raise KnownError("version-conflict", "file request identity already used")
            read_agent_file(self.data_dir, old)
            return old
        if len(files) >= 64:
            raise ConfigInvalidError("file library limit exceeded")
        publish_agent_file(self.data_dir, file, text)
        return self.store.put_agent_file(file)
