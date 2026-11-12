import json
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from ..domain.outcomes import AdvanceOutcomeDto
from ..domain.requests import (
    CreativeDraftRequest,
    CreativeRegenerateRequest,
    SelectCreativeRequest,
    WorkCreateRequest,
)
from ..domain.work import Artifact, Work
from ..errors import KnownError
from ..pipeline_generation import GenerationPipeline
from ..services.validation import validation_metadata


def _error(error: KnownError) -> JSONResponse:
    statuses = {
        "invalid-input": 400,
        "bad-json": 400,
        "payload-too-large": 413,
        "work-not-found": 404,
        "artifact-not-found": 404,
        "chapter-not-ready": 409,
        "advance-in-progress": 409,
        "version-conflict": 409,
        "upstream-changed": 409,
        "artifact-already-approved": 409,
        "setting-gate-not-ready": 409,
        "setting-approval-required": 409,
        "beat-gate-not-ready": 409,
        "beat-approval-required": 409,
        "prose-approval-required": 409,
        "prose-gate-not-ready": 409,
        "direction-not-selected": 409,
        "invalid-content": 422,
        "input-budget-exceeded": 422,
        "llm-invalid-output": 502,
        "llm-unavailable": 503,
        "llm-timeout": 504,
    }
    content = {
        "code": error.code,
        "message": error.message,
        "retryable": error.retryable,
        **({"attemptId": error.attemptId} if error.attemptId is not None else {}),
    }
    return JSONResponse(
        status_code=statuses.get(error.code, 500),
        content=content
        if error.code in statuses
        else {"code": "internal-error", "message": "response unavailable", "retryable": False},
    )


async def _json_body(
    request: Request,
    limit: int | None = 1_048_576,
    message: str = "request body exceeds byte limit",
) -> Any:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if limit is not None and len(body) > limit:
            raise KnownError("payload-too-large", message)
    try:
        return json.loads(bytes(body).decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise KnownError("bad-json", "invalid json body") from error


def _invalid(error: ValidationError, code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "code": code,
            "message": message,
            "retryable": False,
            **validation_metadata(error),
        },
    )


def register_write_routes(app: FastAPI, pipeline: GenerationPipeline) -> None:
    @app.post("/api/works", response_model=Work, status_code=201)
    async def create_work(request: Request) -> Any:
        try:
            parsed = WorkCreateRequest.model_validate(await _json_body(request))
        except ValidationError as error:
            return _invalid(error, "invalid-input", "invalid input", 400)
        except KnownError as error:
            return _error(error)
        return pipeline.create_work(parsed.seed, parsed.title)

    @app.post("/api/works/{work_id}/advance", response_model=AdvanceOutcomeDto)
    async def advance(work_id: str) -> Any:
        request_id = str(uuid4())
        cursor = pipeline.telemetry.cursor
        try:
            outcome = await pipeline.advance(
                work_id, request_id=request_id, telemetry_cursor=cursor
            )
        except KnownError as error:
            return _error(error)
        result = {
            **outcome,
            "telemetry": pipeline.telemetry.telemetry_for(work_id, cursor),
        }
        for key in ("state", "beatCommand", "proseCommand"):
            value = result.get(key)
            if isinstance(value, BaseModel):
                result[key] = value.model_dump(mode="json")
        return result

    @app.put("/api/works/{work_id}/artifacts/creative", response_model=Artifact)
    async def save_creative(work_id: str, request: Request) -> Any:
        try:
            parsed = CreativeDraftRequest.model_validate(await _json_body(request))
            return pipeline.save_creative_draft(work_id, parsed.expectedHeadVersion, parsed.content)
        except ValidationError as error:
            return _invalid(error, "invalid-content", "invalid content", 422)
        except KnownError as error:
            return _error(error)

    @app.post("/api/works/{work_id}/artifacts/creative/select", response_model=Artifact)
    async def select_creative(work_id: str, request: Request) -> Any:
        try:
            parsed = SelectCreativeRequest.model_validate(await _json_body(request))
            return pipeline.select_creative(work_id, parsed.directionId, parsed.expectedHeadVersion)
        except ValidationError as error:
            return _invalid(error, "invalid-input", "invalid input", 400)
        except KnownError as error:
            return _error(error)

    @app.post("/api/works/{work_id}/artifacts/creative/regenerate", response_model=Artifact)
    async def regenerate_creative(work_id: str, request: Request) -> Any:
        try:
            parsed = CreativeRegenerateRequest.model_validate(
                await _json_body(
                    request,
                    limit=1024 * 1024,
                    message="creative regeneration request exceeds body limit",
                )
            )
            return await pipeline.regenerate_creative(work_id, parsed, request_id=str(uuid4()))
        except ValidationError as error:
            return _invalid(error, "invalid-input", "invalid creative regeneration request", 400)
        except KnownError as error:
            return _error(error)
