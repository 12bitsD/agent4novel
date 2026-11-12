from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..domain.diagnostics import DiagnosticQuery, DiagnosticResponse
from ..domain.work import Artifact, WorkSummary, WorkView
from ..pipeline import Pipeline, chapter_summaries, current_chapter_of, workflow_of
from ..store.sqlite import SqliteReadStore


def _error(code: str, message: str) -> dict[str, Any]:
    return {"code": code, "message": message, "retryable": False}


def register_work_routes(app: FastAPI, store: SqliteReadStore, pipeline: Pipeline) -> None:
    @app.get(
        "/api/works/{work_id}/artifacts/{kind}/{chapter}/versions/{version}",
        response_model=Artifact,
    )
    def historical_artifact(
        work_id: str, kind: str, chapter: int, version: int, artifactId: str
    ) -> Any:
        if (
            kind not in {"beat", "prose"}
            or chapter < 1
            or version < 1
            or not artifactId
            or len(artifactId) > 128
        ):
            return JSONResponse(
                status_code=400,
                content=_error("invalid-input", "invalid historical artifact reference"),
            )
        if store.get_work(work_id) is None:
            return JSONResponse(status_code=404, content=_error("work-not-found", "work not found"))
        artifact = store.get_artifact_version(work_id, kind, chapter, artifactId, version)
        if artifact is None:
            return JSONResponse(
                status_code=404, content=_error("artifact-not-found", "artifact version not found")
            )
        return artifact

    @app.get("/api/works", response_model=list[WorkSummary])
    def list_works() -> list[WorkSummary]:
        return store.list_works()

    @app.get("/api/works/{work_id}", response_model=WorkView)
    def get_work(work_id: str) -> Any:
        work = store.get_work(work_id)
        if work is None:
            return JSONResponse(status_code=404, content=_error("work-not-found", "not found"))
        state = pipeline.get_state(work_id)
        workflow_state, allowed_actions = workflow_of(
            state, pipeline.failure_of(work_id), pipeline.completion_kind
        )
        return WorkView.model_validate(
            {
                **work.model_dump(),
                "currentChapter": current_chapter_of(work),
                "chapters": chapter_summaries(work, pipeline.repeat_chapters),
                "workflowState": workflow_state,
                "allowedActions": allowed_actions,
                "nextStepId": state.nextStepId,
            }
        )

    @app.get("/api/works/{work_id}/telemetry", response_model=DiagnosticResponse)
    def telemetry(work_id: str, request: Request) -> Any:
        if store.get_work(work_id) is None:
            return JSONResponse(status_code=404, content=_error("work-not-found", "not found"))
        values: dict[str, str] = {}
        for key, value in request.query_params.multi_items():
            if key not in {"requestId", "attemptId"} or key in values:
                return JSONResponse(
                    status_code=400, content=_error("invalid-input", "invalid diagnostic query")
                )
            values[key] = value
        try:
            query = DiagnosticQuery.model_validate(values)
        except ValueError:
            return JSONResponse(
                status_code=400, content=_error("invalid-input", "invalid diagnostic query")
            )
        return pipeline.telemetry.diagnostics_for(
            work_id,
            str(query.requestId) if query.requestId is not None else None,
            query.attemptId,
        )
