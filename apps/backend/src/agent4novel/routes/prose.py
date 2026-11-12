import time
from typing import Any, Literal, cast

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ..domain.commands import (
    ProseCommandErrorBody,
    ProseCommandResponse,
    ProseHead,
    ProseRejectedObservation,
)
from ..domain.requests import (
    ProseApproveRequest,
    ProseRegenerateRequest,
    ProseRequestHead,
    ProseSaveRequest,
    ProseSaveRequestHead,
)
from ..errors import KnownError
from ..pipeline import workflow_of
from ..pipeline_generation import GenerationPipeline
from ..services.command_runtime import (
    CommandScope,
    ProseCommandError,
    ProseExecution,
    observe_prose,
    prose_failure_code,
    prose_response_error,
)
from ..store.work import timestamp
from .writes import _json_body


def register_prose_routes(app: FastAPI, pipeline: GenerationPipeline) -> None:
    def rejected(
        work_id: str,
        operation: Literal["generate-prose", "regenerate-prose", "approve-prose", "save-prose"],
        scope: CommandScope,
        code: str,
    ) -> JSONResponse:
        command = ProseRejectedObservation(
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
        body = ProseCommandErrorBody(
            code=code,
            message=code,
            retryable=False,
            command=command,
        )
        return JSONResponse(
            status_code=413 if code == "payload-too-large" else 400,
            content=body.model_dump(mode="json"),
        )

    def command_error(error: ProseCommandError, scope: CommandScope, work_id: str) -> JSONResponse:
        cause = error.cause
        stage = error.command.failureStage or "response"
        code = prose_failure_code(cause, stage)
        known = cause if isinstance(cause, KnownError) and stage != "response" else None
        content: dict[str, Any] = {
            "code": code,
            "message": code,
            "retryable": known.retryable if known else False,
            "command": error.command,
            "telemetry": pipeline.telemetry.telemetry_for(work_id, scope.cursor),
        }
        if known and known.inputBudget is not None:
            content["inputBudget"] = known.inputBudget
        if isinstance(cause, ValidationError) and code == "invalid-content" and stage != "response":
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
        body = ProseCommandErrorBody.model_validate(content)
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

    @app.post("/api/works/{work_id}/artifacts/prose/{operation}")
    async def prose_command(work_id: str, operation: str, request: Request) -> Any:
        if operation not in {"approve", "regenerate", "save"}:
            return JSONResponse(
                status_code=404,
                content={"code": "not-found", "message": "route not found", "retryable": False},
            )
        scope = CommandScope.create(pipeline.runtime)
        command_operation = cast(
            Literal["approve-prose", "regenerate-prose", "save-prose"],
            f"{operation}-prose",
        )
        try:
            body = await _json_body(
                request, limit=1024 * 1024, message="prose request exceeds body limit"
            )
        except KnownError as error:
            return rejected(work_id, command_operation, scope, error.code)
        head_model = ProseSaveRequestHead if operation == "save" else ProseRequestHead
        try:
            head = head_model.model_validate(body)
        except ValidationError as error:
            code = (
                "unsupported-chapter"
                if any(issue["loc"] and issue["loc"][0] == "chapter" for issue in error.errors())
                else "invalid-input"
            )
            return rejected(work_id, command_operation, scope, code)
        model = (
            ProseApproveRequest
            if operation == "approve"
            else ProseSaveRequest
            if operation == "save"
            else ProseRegenerateRequest
        )
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
        expected_head = {
            "artifactId": head.expectedArtifactId,
            "version": head.expectedHeadVersion,
            **(
                {"humanStatus": head.expectedHumanStatus}
                if isinstance(head, ProseSaveRequestHead)
                else {}
            ),
        }
        try:
            if validation_error is not None:

                async def invalid(execution: ProseExecution) -> Any:
                    execution.stage = "input"
                    assert validation_error is not None
                    raise validation_error

                await observe_prose(
                    work_id,
                    command_operation,
                    ProseHead.model_validate(expected_head),
                    invalid,
                    buffer=pipeline.telemetry,
                    scope=scope,
                    chapter=head.chapter,
                )
                raise AssertionError("unreachable")
            assert parsed is not None
            if operation == "approve":
                assert isinstance(parsed, ProseApproveRequest)
                artifact, command = await pipeline.approve_prose(work_id, parsed, scope)
            elif operation == "save":
                assert isinstance(parsed, ProseSaveRequest)
                artifact, command = await pipeline.save_prose(work_id, parsed, scope)
            else:
                assert isinstance(parsed, ProseRegenerateRequest)
                artifact, command = await pipeline.regenerate_prose(work_id, parsed, scope)
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
                response = ProseCommandResponse.model_validate(
                    {
                        "artifact": artifact,
                        "command": command,
                        "workflow": workflow,
                        "telemetry": pipeline.telemetry.telemetry_for(work_id, scope.cursor),
                    }
                )
                return JSONResponse(content=response.model_dump(mode="json"))
            except Exception as cause:
                raise prose_response_error(
                    work_id, command, cause, buffer=pipeline.telemetry, scope=scope
                ) from cause
        except ProseCommandError as error:
            return command_error(error, scope, work_id)
