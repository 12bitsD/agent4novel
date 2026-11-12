from collections.abc import Mapping
from pathlib import Path
from typing import Protocol, cast

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .agent.runtime import ModelRuntime
from .config import model_is_demo, parse_server_config, repository_root, runtime_environment
from .contracts import AppConfigResponse, HealthResponse
from .domain.requests import WorkCreateRequest
from .pipeline_generation import GenerationPipeline
from .routes.beat import register_beat_routes
from .routes.chapters import register_chapter_routes
from .routes.prose import register_prose_routes
from .routes.resources import register_resource_routes
from .routes.review import register_review_routes
from .routes.works import register_work_routes
from .routes.writes import register_write_routes
from .services.author_writes import AuthorWriteService
from .static_web import register_static_web
from .store.resources import SqliteResourceStore
from .store.sqlite import SqliteReadStore


class DemoSeedStore(Protocol):
    def create_works_if_empty(self, inputs: list[WorkCreateRequest]) -> bool: ...


DEMO_WORKS = [
    WorkCreateRequest(
        seed="一个都市异能校园故事：主角觉醒读心能力，卷入校园异能者暗战",
        title="都市异能：读心校草",
    ),
    WorkCreateRequest(seed="一个玄幻世界的力量体系设定：九境修炼，灵根分级", title="玄界九境"),
    WorkCreateRequest(seed="一个悬疑推理的开篇：小镇连续失踪案，主角是唯一目击者", title="迷雾镇"),
]


def create_app(
    env: Mapping[str, str] | None = None,
    root: Path | None = None,
    store: SqliteReadStore | None = None,
    runtime: ModelRuntime | None = None,
) -> FastAPI:
    app = FastAPI(title="agent4novel")
    values = env if env is not None else runtime_environment(root or repository_root())

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.get("/api/config", response_model=AppConfigResponse)
    def config() -> AppConfigResponse:
        return AppConfigResponse(demo=model_is_demo(values))

    @app.exception_handler(RequestValidationError)
    async def validation_exception(
        _request: Request, _error: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"code": "invalid-input", "message": "invalid input", "retryable": False},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception(_request: Request, error: StarletteHTTPException) -> JSONResponse:
        if error.status_code == 404:
            return JSONResponse(
                status_code=404,
                content={"code": "not-found", "message": "route not found", "retryable": False},
            )
        return JSONResponse(
            status_code=500,
            content={
                "code": "internal-error",
                "message": "response unavailable",
                "retryable": False,
            },
        )

    @app.exception_handler(Exception)
    async def internal_exception(_request: Request, _error: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={
                "code": "internal-error",
                "message": "response unavailable",
                "retryable": False,
            },
        )

    server_config = parse_server_config(values, root or repository_root())
    if store is None:
        store = (
            SqliteResourceStore(":memory:")
            if env is not None and "A4N_DATA_DIR" not in values
            else SqliteResourceStore(server_config.database_path)
        )
    if server_config.seed_demo:
        cast(DemoSeedStore, store).create_works_if_empty(DEMO_WORKS)
    runtime = runtime or ModelRuntime(values)
    author_config = AuthorWriteService(store, values, server_config.data_dir, runtime)
    pipeline = GenerationPipeline(store, runtime=runtime, author_config=author_config)
    register_work_routes(app, store, pipeline)
    register_write_routes(app, pipeline)
    register_review_routes(app, pipeline)
    register_beat_routes(app, pipeline)
    register_prose_routes(app, pipeline)
    register_chapter_routes(app, pipeline)
    register_resource_routes(app, store, values, server_config.data_dir, author_config)
    if server_config.serve_web:
        register_static_web(app, (root or repository_root()) / "apps/web/dist")
    return app


def run() -> None:
    root = repository_root()
    values = runtime_environment(root)
    config = parse_server_config(values, root)
    uvicorn.run(create_app(env=values), host=config.host, port=config.port)
