from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ..domain.requests import (
    ApproveRequest,
    OutlineApprovalRequest,
    OutlineDraftRequest,
    SettingApproveRequest,
)
from ..domain.work import Artifact, PipelineState
from ..errors import KnownError
from ..pipeline_generation import GenerationPipeline
from ..services.review_content import SettingValidationError
from ..services.validation import validation_metadata
from .writes import _error, _invalid, _json_body


def register_review_routes(app: FastAPI, pipeline: GenerationPipeline) -> None:
    @app.put("/api/works/{work_id}/artifacts/outline", response_model=Artifact)
    async def save_outline(work_id: str, request: Request) -> Any:
        try:
            parsed = OutlineDraftRequest.model_validate(await _json_body(request))
            return pipeline.save_outline_draft(work_id, parsed)
        except ValidationError as error:
            return _invalid(error, "invalid-content", "invalid content", 422)
        except KnownError as error:
            return _error(error)

    @app.post("/api/works/{work_id}/artifacts/outline/approve", response_model=Artifact)
    async def approve_outline(work_id: str, request: Request) -> Any:
        try:
            parsed = OutlineApprovalRequest.model_validate(
                await _json_body(
                    request,
                    limit=4096,
                    message="outline approval request exceeds body limit",
                )
            )
            return pipeline.approve_outline(work_id, parsed)
        except ValidationError as error:
            return _invalid(error, "invalid-input", "invalid outline approval request", 400)
        except KnownError as error:
            return _error(error)

    @app.post("/api/works/{work_id}/artifacts/setting/approve", response_model=Artifact)
    async def approve_setting(work_id: str, request: Request) -> Any:
        try:
            parsed = SettingApproveRequest.model_validate(
                await _json_body(
                    request,
                    limit=2 * 1024 * 1024,
                    message="setting approval request exceeds body limit",
                )
            )
            return pipeline.approve_setting(work_id, parsed)
        except ValidationError as error:
            return _invalid(error, "invalid-content", "invalid setting content", 422)
        except SettingValidationError as error:
            return JSONResponse(
                status_code=422,
                content={
                    "code": "invalid-content",
                    "message": "invalid setting content",
                    "retryable": False,
                    **validation_metadata(
                        [
                            {
                                "path": ["content", *issue["path"]],
                                "code": issue["code"],
                                "message": issue["message"],
                            }
                            for issue in error.issues
                        ]
                    ),
                },
            )
        except KnownError as error:
            return _error(error)

    @app.post("/api/works/{work_id}/approve", response_model=PipelineState)
    async def approve(work_id: str, request: Request) -> Any:
        try:
            parsed = ApproveRequest.model_validate(await _json_body(request))
            return pipeline.approve(work_id, parsed)
        except ValidationError as error:
            return _invalid(error, "invalid-input", "invalid input", 400)
        except KnownError as error:
            return _error(error)
