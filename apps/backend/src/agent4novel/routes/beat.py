import time
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ..domain.commands import (
    BeatCommandErrorBody,
    BeatCommandResponse,
    BeatHead,
    BeatRejectedObservation,
    BeatVariantSelectionResponse,
)
from ..domain.requests import (
    BeatApproveRequest,
    BeatRegenerateRequest,
    BeatRequestHead,
    BeatVariantSelectionRequest,
)
from ..errors import KnownError
from ..pipeline import workflow_of
from ..pipeline_generation import GenerationPipeline
from ..services.command_runtime import (
    BeatCommandError,
    BeatExecution,
    CommandScope,
    beat_failure_code,
    beat_response_error,
    observe_beat,
)
from ..store.work import timestamp
from .writes import _error, _json_body


def register_beat_routes(app: FastAPI, pipeline: GenerationPipeline) -> None:
    def rejected(
        work_id: str,
        operation: Literal["generate-beat", "regenerate-beat", "approve-beat"],
        scope: CommandScope,
        code: str,
    ) -> JSONResponse:
        command = BeatRejectedObservation(
            kind="request-rejected",
            requestId=scope.request_id,
            operation=operation,
            executionMode=scope.execution_mode,
            latencyMs=max(0, int((time.monotonic() - scope.started) * 1000)),
            attemptIds=[],
        )
        pipeline.telemetry.record_command(
            work_id,
            {
                "command": command.model_dump(mode="json"),
                "code": code,
                "recordedAt": timestamp(),
            },
        )
        body = BeatCommandErrorBody(
            code=code,
            message=code,
            retryable=False,
            command=command,
        )
        return JSONResponse(
            status_code=413 if code == "payload-too-large" else 400,
            content=body.model_dump(mode="json"),
        )

    def command_error(error: BeatCommandError, scope: CommandScope, work_id: str) -> JSONResponse:
        cause = error.cause
        stage = error.command.failureStage or "response"
        code = beat_failure_code(cause, stage)
        known = cause if isinstance(cause, KnownError) else None
        content: dict[str, Any] = {
            "code": code,
            "message": code,
            "retryable": known.retryable if known else False,
            "command": error.command,
            "telemetry": pipeline.telemetry.telemetry_for(work_id, scope.cursor),
        }
        if known and known.inputBudget is not None:
            content["inputBudget"] = known.inputBudget
        if isinstance(cause, ValidationError) and code == "invalid-content":
            content["issues"] = [
                {
                    "path": list(issue["loc"])
                    if issue["loc"] and issue["loc"][0] in {"content", "instructions"}
                    else ["content", *issue["loc"]],
                    "code": issue["type"],
                    "message": "invalid field",
                }
                for issue in cause.errors()
            ]
        body = BeatCommandErrorBody.model_validate(content)
        status = (
            422
            if code in {"invalid-content", "input-budget-exceeded"}
            else 404
            if code in {"work-not-found", "artifact-not-found"}
            else 502
            if code == "llm-invalid-output"
            else 503
            if code == "llm-unavailable"
            else 504
            if code == "llm-timeout"
            else 409
            if known
            else 500
        )
        return JSONResponse(status_code=status, content=body.model_dump(mode="json"))

    @app.post("/api/works/{work_id}/artifacts/beat/{operation}")
    async def beat_command(work_id: str, operation: str, request: Request) -> Any:
        if operation == "select":
            return await select_beat_variant(work_id, request)
        if operation not in {"approve", "regenerate"}:
            return JSONResponse(
                status_code=404,
                content={"code": "not-found", "message": "route not found", "retryable": False},
            )
        scope = CommandScope.create(pipeline.runtime)
        command_operation: Literal["approve-beat", "regenerate-beat"] = (
            "approve-beat" if operation == "approve" else "regenerate-beat"
        )
        try:
            body = await _json_body(
                request,
                limit=1024 * 1024,
                message="beat request exceeds body limit",
            )
        except KnownError as error:
            return rejected(work_id, command_operation, scope, error.code)
        try:
            head = BeatRequestHead.model_validate(body)
        except ValidationError as error:
            code = (
                "unsupported-chapter"
                if any(issue["loc"] and issue["loc"][0] == "chapter" for issue in error.errors())
                else "invalid-input"
            )
            return rejected(work_id, command_operation, scope, code)
        model = BeatApproveRequest if operation == "approve" else BeatRegenerateRequest
        try:
            parsed = model.model_validate(body)
            validation_error = None
        except ValidationError as error:
            parsed = None
            validation_error = error
            if any(
                issue["loc"] and issue["loc"][0] not in {"content", "instructions"}
                for issue in error.errors()
            ):
                return rejected(work_id, command_operation, scope, "invalid-input")
        try:
            if validation_error is not None:

                async def invalid(execution: BeatExecution) -> Any:
                    execution.stage = "input"
                    assert validation_error is not None
                    raise validation_error

                await observe_beat(
                    work_id,
                    command_operation,
                    BeatHead(
                        artifactId=head.expectedArtifactId,
                        version=head.expectedHeadVersion,
                    ),
                    invalid,
                    buffer=pipeline.telemetry,
                    scope=scope,
                    chapter=head.chapter,
                )
                raise AssertionError("unreachable")
            assert parsed is not None
            if operation == "approve":
                assert isinstance(parsed, BeatApproveRequest)
                artifact, command = await pipeline.approve_beat(work_id, parsed, scope)
                result: dict[str, Any] = {"artifact": artifact, "command": command}
            else:
                assert isinstance(parsed, BeatRegenerateRequest)
                result = await pipeline.regenerate_beat(work_id, parsed, scope)
            try:
                if operation == "regenerate":
                    workflow = pipeline.chapter_workflow(
                        pipeline.store.get_work(work_id), head.chapter
                    )
                else:
                    state = pipeline.get_state(work_id)
                    workflow_state, allowed_actions = workflow_of(
                        state, pipeline.failure_of(work_id), pipeline.completion_kind
                    )
                    workflow = {
                        "workflowState": workflow_state,
                        "nextStepId": state.nextStepId,
                        "allowedActions": allowed_actions,
                    }
                response = BeatCommandResponse.model_validate(
                    {
                        **result,
                        "workflow": workflow,
                        "telemetry": pipeline.telemetry.telemetry_for(work_id, scope.cursor),
                    }
                )
                return JSONResponse(content=response.model_dump(mode="json"))
            except Exception as cause:
                raise beat_response_error(
                    work_id,
                    result["command"],
                    cause,
                    buffer=pipeline.telemetry,
                    scope=scope,
                ) from cause
        except BeatCommandError as error:
            return command_error(error, scope, work_id)

    @app.post(
        "/api/works/{work_id}/artifacts/beat/select", response_model=BeatVariantSelectionResponse
    )
    async def select_beat_variant(work_id: str, request: Request) -> Any:
        try:
            parsed = BeatVariantSelectionRequest.model_validate(
                await _json_body(request, limit=1024 * 1024, message="request body too large")
            )
            return pipeline.select_beat_variant(work_id, parsed)
        except ValidationError:
            return JSONResponse(
                status_code=400,
                content={
                    "code": "invalid-input",
                    "message": "invalid beat variant selection",
                    "retryable": False,
                },
            )
        except KnownError as error:
            if error.code in {"work-not-found", "artifact-not-found"}:
                return _error(error)
            return JSONResponse(
                status_code=409,
                content={
                    "code": error.code,
                    "message": error.message,
                    "retryable": error.retryable,
                },
            )
