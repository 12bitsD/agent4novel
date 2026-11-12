from typing import Any

from fastapi import FastAPI, Request
from pydantic import BaseModel, ValidationError

from ..domain.outcomes import AdvanceOutcomeDto
from ..domain.requests import StartChapterRequest
from ..errors import KnownError
from ..pipeline_generation import GenerationPipeline
from ..services.command_runtime import CommandScope
from .writes import _error, _invalid, _json_body


def register_chapter_routes(app: FastAPI, pipeline: GenerationPipeline) -> None:
    @app.post("/api/works/{work_id}/chapters/start", response_model=AdvanceOutcomeDto)
    async def start_chapter(work_id: str, request: Request) -> Any:
        try:
            parsed = StartChapterRequest.model_validate(
                await _json_body(request, limit=4096, message="chapter request exceeds body limit")
            )
        except ValidationError as error:
            return _invalid(error, "invalid-input", "invalid chapter start request", 400)
        except KnownError as error:
            return _error(error)
        scope = CommandScope.create(pipeline.runtime)
        try:
            outcome = await pipeline.start_chapter(work_id, parsed, scope=scope)
        except KnownError as error:
            return _error(error)
        result = {
            **outcome,
            "telemetry": pipeline.telemetry.telemetry_for(work_id, scope.cursor),
        }
        for key in ("state", "beatCommand", "proseCommand"):
            value = result.get(key)
            if isinstance(value, BaseModel):
                result[key] = value.model_dump(mode="json")
        return result
