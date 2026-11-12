import uuid
from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ..domain.resources import (
    AgentFile,
    AgentFileRead,
    AgentFileUpload,
    AuthorConfigReceipt,
    AuthorConfigSave,
    AuthorConfigView,
    BadExample,
    BadExamplePage,
    BadExampleRequest,
    SettingExtensionActionRequest,
    SettingExtensionProposeRequest,
)
from ..errors import KnownError
from ..services.author_config import ConfigInvalidError
from ..services.author_writes import AuthorWriteService
from ..services.files import AgentFileUnavailableError, read_agent_file
from ..services.setting_extension import extension_resource, is_valid_approved_extension_candidate
from ..services.validation import validation_metadata
from ..store.sqlite import StoreContractError, WorkNotFoundError
from .writes import _error as _write_error
from .writes import _json_body


def _error(code: str, message: str) -> dict[str, Any]:
    return {"code": code, "message": message, "retryable": False}


def _unavailable() -> dict[str, Any]:
    return _error("internal-error", "response unavailable")


EXTENSION_STATUSES = {
    "invalid-input": 400,
    "work-not-found": 404,
    "setting-extension-not-found": 404,
    "setting-extension-base-conflict": 409,
    "setting-extension-request-conflict": 409,
    "setting-extension-stale": 409,
    "setting-extension-chapter-pending": 409,
    "setting-extension-state-conflict": 409,
    "setting-extension-limit": 422,
    "setting-extension-invalid": 422,
}


def register_resource_routes(
    app: FastAPI,
    store: Any,
    env: Mapping[str, str],
    data_dir: Any,
    author_config: AuthorWriteService | None = None,
) -> None:
    author_config = author_config or AuthorWriteService(store, env, data_dir)

    @app.get("/api/works/{work_id}/agent-config", response_model=AuthorConfigView)
    def get_author_config(work_id: str) -> Any:
        try:
            return author_config.get(work_id)
        except WorkNotFoundError:
            return JSONResponse(
                status_code=404,
                content=_error("work-not-found", f"work not found: {work_id}"),
            )
        except ConfigInvalidError:
            return JSONResponse(
                status_code=400,
                content=_error("config-invalid", "invalid author configuration or file"),
            )

    @app.get("/api/works/{work_id}/agent-files/{file_id}", response_model=AgentFileRead)
    def get_agent_file(work_id: str, file_id: str) -> Any:
        try:
            file = next(
                (item for item in store.list_agent_files(work_id) if item.id == file_id), None
            )
            if file is None:
                raise AgentFileUnavailableError
            return read_agent_file(data_dir, file)
        except WorkNotFoundError:
            return JSONResponse(
                status_code=404,
                content=_error("work-not-found", f"work not found: {work_id}"),
            )
        except AgentFileUnavailableError:
            return JSONResponse(
                status_code=404,
                content=_error(
                    "agent-file-unavailable", "selected agent file is unavailable or changed"
                ),
            )

    @app.get("/api/works/{work_id}/setting-extensions/{request_id}")
    def get_setting_extension(work_id: str, request_id: str) -> Any:
        try:
            uuid.UUID(request_id)
        except ValueError:
            return JSONResponse(
                status_code=400,
                content=_error("invalid-input", "invalid setting extension request"),
            )
        try:
            record = store.get_setting_extension(work_id, request_id)
            if record is not None and record.status == "approved" and record.candidate is not None:
                candidate = store.get_artifact_version(
                    work_id, "setting", None, record.candidate.artifactId, record.candidate.version
                )
                if not is_valid_approved_extension_candidate(record, candidate):
                    raise StoreContractError
            work = store.get_work(work_id)
            if work is None:
                raise WorkNotFoundError
            return extension_resource(work, request_id, record)
        except StoreContractError:
            return JSONResponse(status_code=500, content=_unavailable())
        except WorkNotFoundError:
            return JSONResponse(status_code=404, content=_error("work-not-found", "work-not-found"))

    @app.post("/api/works/{work_id}/setting-extensions", status_code=201)
    @app.post("/api/works/{work_id}/setting-extensions/{request_id}/approve")
    @app.post("/api/works/{work_id}/setting-extensions/{request_id}/cancel")
    async def write_setting_extension(
        work_id: str, request: Request, request_id: str | None = None
    ) -> Any:
        operation = "propose" if request_id is None else request.url.path.rsplit("/", 1)[-1]
        if request_id is not None:
            try:
                uuid.UUID(request_id)
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content=_error("invalid-input", "invalid setting extension request"),
                )
        try:
            body = await _json_body(
                request, limit=2_097_152, message="setting extension body exceeds limit"
            )
            parsed: SettingExtensionProposeRequest | SettingExtensionActionRequest
            if operation == "propose":
                parsed = SettingExtensionProposeRequest.model_validate(body)
            else:
                action = SettingExtensionActionRequest.model_validate(body)
                parsed = action
                if parsed.requestId != request_id:
                    return JSONResponse(
                        status_code=400,
                        content=_error("invalid-input", "invalid setting extension request"),
                    )
            if operation == "propose":
                return store.propose_setting_extension(work_id, parsed)
            if operation == "approve":
                return store.approve_setting_extension(work_id, parsed)
            return store.cancel_setting_extension(work_id, parsed)
        except ValidationError as error:
            limit_error = False
            if operation == "propose" and error.errors():
                limit_error = True
                for issue in error.errors():
                    location = issue["loc"]
                    if not location or location[0] != "extension":
                        limit_error = False
                        break
                    if issue["type"] == "too_long":
                        continue
                    value = body
                    if issue["type"] != "value_error" or location[-1] not in {"title", "content"}:
                        limit_error = False
                        break
                    try:
                        for segment in location:
                            value = value[segment]
                    except (KeyError, IndexError, TypeError):
                        limit_error = False
                        break
                    maximum = 256 if location[-1] == "title" else 20_000
                    if not isinstance(value, str) or len(value) <= maximum:
                        limit_error = False
                        break
            logical_limit = limit_error
            if logical_limit:
                return JSONResponse(
                    status_code=422,
                    content=_error(
                        "setting-extension-limit", "setting extension exceeds logical limits"
                    ),
                )
            return JSONResponse(
                status_code=400,
                content=_error("invalid-input", "invalid setting extension request"),
            )
        except WorkNotFoundError:
            return JSONResponse(status_code=404, content=_error("work-not-found", "work-not-found"))
        except KnownError as error:
            if error.code == "payload-too-large":
                return _write_error(error)
            if error.code == "bad-json":
                return JSONResponse(
                    status_code=400,
                    content=_error("invalid-input", "invalid setting extension request"),
                )
            return JSONResponse(
                status_code=EXTENSION_STATUSES.get(error.code, 500),
                content=_error(error.code, error.message)
                if error.code in EXTENSION_STATUSES
                else _unavailable(),
            )
        except StoreContractError:
            return JSONResponse(status_code=500, content=_unavailable())

    @app.post("/api/works/{work_id}/bad-examples", response_model=BadExample)
    async def mark_bad_example(work_id: str, request: Request) -> Any:
        try:
            parsed = BadExampleRequest.model_validate(
                await _json_body(
                    request, limit=196_608, message="selection request exceeds byte limit"
                )
            )
            return store.mark_bad_example(work_id, parsed)
        except ValidationError as error:
            return JSONResponse(
                status_code=400,
                content={
                    **_error("bad-example-invalid", "invalid bad-example selection"),
                    **validation_metadata(error),
                },
            )
        except WorkNotFoundError:
            return JSONResponse(
                status_code=404, content=_error("work-not-found", f"work not found: {work_id}")
            )
        except KnownError as error:
            if error.code == "payload-too-large":
                return _write_error(error)
            if error.code == "bad-json":
                return JSONResponse(
                    status_code=400,
                    content=_error("bad-example-invalid", "invalid selection request"),
                )
            status = 409 if error.code == "version-conflict" else 400
            return JSONResponse(status_code=status, content=_error(error.code, error.message))

    @app.get(
        "/api/works/{work_id}/bad-examples",
        response_model=BadExamplePage,
        response_model_exclude_none=True,
    )
    def list_bad_examples(work_id: str, request: Request) -> Any:
        values: dict[str, int] = {}
        for key, value in request.query_params.multi_items():
            if (
                key not in {"chapter", "after"}
                or key in values
                or not value.isascii()
                or not value.isdigit()
                or not 1 <= int(value) <= 9_007_199_254_740_991
                or value.startswith("0")
            ):
                return JSONResponse(
                    status_code=400,
                    content=_error("bad-example-invalid", "invalid selection query"),
                )
            values[key] = int(value)
        try:
            return store.list_bad_examples(work_id, values.get("chapter"), values.get("after"))
        except WorkNotFoundError:
            return JSONResponse(
                status_code=404,
                content=_error("work-not-found", f"work not found: {work_id}"),
            )

    @app.get("/api/works/{work_id}/bad-examples/{sample_id}", response_model=BadExample)
    def get_bad_example(work_id: str, sample_id: str) -> Any:
        try:
            record = store.get_bad_example(work_id, sample_id)
        except WorkNotFoundError:
            return JSONResponse(
                status_code=404,
                content=_error("work-not-found", f"work not found: {work_id}"),
            )
        if record is None:
            return JSONResponse(
                status_code=404, content=_error("bad-example-not-found", "bad example not found")
            )
        return record

    @app.put("/api/works/{work_id}/agent-config", response_model=AuthorConfigReceipt)
    async def save_author_config(work_id: str, request: Request) -> Any:
        try:
            parsed = AuthorConfigSave.model_validate(
                await _json_body(
                    request, limit=196_608, message="configuration request exceeds byte limit"
                )
            )
            return author_config.save(work_id, parsed)
        except ValidationError:
            return JSONResponse(
                status_code=400,
                content=_error("config-invalid", "invalid author configuration or file"),
            )
        except ConfigInvalidError:
            return JSONResponse(
                status_code=400,
                content=_error("config-invalid", "invalid author configuration or file"),
            )
        except AgentFileUnavailableError:
            return JSONResponse(
                status_code=404,
                content=_error(
                    "agent-file-unavailable", "selected agent file is unavailable or changed"
                ),
            )
        except WorkNotFoundError:
            return JSONResponse(
                status_code=404,
                content=_error("work-not-found", f"work not found: {work_id}"),
            )
        except KnownError as error:
            return _write_error(error)

    @app.post("/api/works/{work_id}/agent-files", response_model=AgentFile)
    async def upload_agent_file(work_id: str, request: Request) -> Any:
        try:
            parsed = AgentFileUpload.model_validate(
                await _json_body(
                    request, limit=196_608, message="configuration request exceeds byte limit"
                )
            )
            return author_config.upload(work_id, parsed)
        except ValidationError:
            return JSONResponse(
                status_code=400,
                content=_error("config-invalid", "invalid author configuration or file"),
            )
        except ConfigInvalidError:
            return JSONResponse(
                status_code=400,
                content=_error("config-invalid", "invalid author configuration or file"),
            )
        except AgentFileUnavailableError:
            return JSONResponse(
                status_code=404,
                content=_error(
                    "agent-file-unavailable", "selected agent file is unavailable or changed"
                ),
            )
        except WorkNotFoundError:
            return JSONResponse(
                status_code=404,
                content=_error("work-not-found", f"work not found: {work_id}"),
            )
        except KnownError as error:
            return _write_error(error)
