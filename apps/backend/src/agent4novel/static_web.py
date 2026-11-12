from pathlib import Path
from urllib.parse import unquote_to_bytes

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class WebBuildError(ValueError):
    code = "web-build-missing"


def _contained(root: Path, target: Path) -> bool:
    return target == root or root in target.parents


def validate_web_root(directory: Path) -> Path:
    try:
        root = directory.resolve(strict=True)
        index = (root / "index.html").resolve(strict=True)
        if not _contained(root, index) or not index.is_file():
            raise WebBuildError
        return root
    except (OSError, RuntimeError, WebBuildError):
        raise WebBuildError from None


def register_static_web(app: FastAPI, directory: Path) -> None:
    root = validate_web_root(directory)

    @app.get("/{path:path}")
    def serve(request: Request, path: str) -> FileResponse:
        raw_path = request.scope["path"]
        if "%2f" in raw_path.lower():
            raise StarletteHTTPException(status_code=404)
        try:
            decoded = unquote_to_bytes(raw_path).decode("utf-8")
        except (UnicodeDecodeError, ValueError):
            raise StarletteHTTPException(status_code=404) from None
        if (
            decoded == "/api"
            or decoded.startswith("/api/")
            or "\\" in decoded
            or "\x00" in decoded
            or any(part.startswith(".") for part in decoded.split("/"))
        ):
            raise StarletteHTTPException(status_code=404)
        try:
            file = (root / ("index.html" if decoded == "/" else decoded.lstrip("/"))).resolve(
                strict=True
            )
            if not _contained(root, file) or not file.is_file():
                raise StarletteHTTPException(status_code=404)
        except (OSError, RuntimeError):
            raise StarletteHTTPException(status_code=404) from None
        return FileResponse(file)
