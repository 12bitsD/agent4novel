from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from test_cli_http_commands import invoke, request_file
from work_fixtures import SEED, SETTING

from agent4novel.main import create_app
from agent4novel.store.work import SqliteStore


def invalid_setting() -> dict:
    return {
        **SETTING,
        "world": [{} for _ in range(129)],
    }


def test_http_validation_issues_are_bounded_with_count(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    work = store.create_work(SEED)
    store.append_artifact(work.id, "setting", SETTING)
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    response = client.post(
        f"/api/works/{work.id}/artifacts/setting/approve",
        json={"expectedHeadVersion": 1, "content": invalid_setting()},
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert len(body["issues"]) == 128
    assert body["issueCount"] == 258
    assert body["issuesTruncated"] is True
    assert all(issue["message"] == "invalid field" for issue in body["issues"])
    store.close()


def test_cli_validation_issues_are_bounded_without_http(tmp_path: Path) -> None:
    calls = []

    def no_http(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        raise AssertionError("invalid input must not reach HTTP")

    path = request_file(
        tmp_path,
        "setting.json",
        {"expectedHeadVersion": 1, "content": invalid_setting()},
    )
    code, error, _, _ = invoke(
        ["approve-setting", "work-1", "--file", path],
        httpx.MockTransport(no_http),
        tmp_path,
    )
    assert code == 1
    assert error["code"] == "invalid-input"
    assert len(error["issues"]) == 128
    assert error["details"]["issueCount"] == 258
    assert error["details"]["issuesTruncated"] is True
    assert calls == []


def test_client_rejects_unbounded_error_issues(tmp_path: Path) -> None:
    def oversized(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            500,
            json={
                "code": "internal-error",
                "message": "response unavailable",
                "retryable": False,
                "issues": [
                    {"path": ["content", index], "code": "invalid", "message": "invalid field"}
                    for index in range(129)
                ],
            },
            request=request,
        )

    code, error, _, _ = invoke(["advance", "work-1"], httpx.MockTransport(oversized), tmp_path)
    assert code == 1
    assert error["code"] == "invalid-response"
    assert error["details"]["writeOutcome"] == "unknown"
