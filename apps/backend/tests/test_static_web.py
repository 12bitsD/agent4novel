from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agent4novel.main import create_app
from agent4novel.static_web import WebBuildError, validate_web_root


def make_web_root(tmp_path: Path) -> Path:
    root = tmp_path / "apps/web/dist"
    root.mkdir(parents=True)
    (root / "index.html").write_text("<html><body>Python backend</body></html>")
    (root / "asset.js").write_text('console.log("ok")')
    return root


def test_serves_built_web_and_keeps_api_error_contract(tmp_path: Path) -> None:
    make_web_root(tmp_path)
    client = TestClient(create_app({"A4N_SERVE_WEB": "1"}, root=tmp_path))
    index = client.get("/")
    assert index.status_code == 200
    assert index.text == "<html><body>Python backend</body></html>"
    assert client.get("/asset.js").status_code == 200
    for path in ["/api/not-found", "/.env.local", "/%2e%2e/secret", "/%2f"]:
        response = client.get(path)
        assert response.status_code == 404, path
        assert response.json()["code"] == "not-found"


def test_web_root_must_contain_index(tmp_path: Path) -> None:
    with pytest.raises(WebBuildError):
        validate_web_root(tmp_path)
