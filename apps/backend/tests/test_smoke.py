from pathlib import Path

import httpx
from test_cli_http_commands import AppTransport, invoke
from work_fixtures import SEED

from agent4novel.main import create_app
from agent4novel.store.work import SqliteStore


def test_smoke_confirms_edited_first_chapter(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    transport = AppTransport(
        create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store)
    )
    code, result, stdout, errors = invoke(["smoke", "--seed", SEED], transport, tmp_path)
    assert code == 0, errors
    assert result["executionMode"] == "demo"
    assert all(step["ok"] for step in result["steps"])
    assert result["final"]["workflowState"] == "prose-approved"
    assert not any((artifact.get("chapter") or 0) > 1 for artifact in result["final"]["artifacts"])
    setting = next(a for a in result["final"]["artifacts"] if a["kind"] == "setting")
    beat = next(a for a in result["final"]["artifacts"] if a["kind"] == "beat")
    prose = next(a for a in result["final"]["artifacts"] if a["kind"] == "prose")
    assert "作者确认" in setting["content"]["overview"]
    assert "作者确认" in beat["content"]["goal"]
    assert "作者定稿" in prose["content"]["text"]
    assert prose["version"] == 2
    assert "[smoke]" in errors
    assert stdout.count("\n") == 1
    store.close()


def test_smoke_failure_keeps_safe_partial_progress(tmp_path: Path) -> None:
    calls = []

    def failed(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path == "/api/config":
            return httpx.Response(200, json={"demo": True}, request=request)
        return httpx.Response(
            500,
            json={"code": "internal-error", "message": "response unavailable", "retryable": False},
            request=request,
        )

    code, error, stdout, _ = invoke(
        ["smoke", "--seed", SEED], httpx.MockTransport(failed), tmp_path
    )
    assert code == 1
    assert error["code"] == "internal-error"
    assert error["details"]["executionMode"] == "demo"
    assert error["details"]["steps"] == [
        {"step": "config", "ok": True, "detail": "demo"},
        {"step": "create", "ok": False, "detail": "internal-error"},
    ]
    assert stdout == ""
    assert len(calls) == 2
