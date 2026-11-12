from pathlib import Path
from typing import Any

import httpx
from fastapi.testclient import TestClient
from test_beat_pipeline import ready_for_beat
from test_cli_http_commands import invoke, request_file
from work_fixtures import SEED

from agent4novel.main import create_app
from agent4novel.store.work import SqliteStore


def app(tmp_path: Path):
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    application = create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store)
    return store, application, TestClient(application)


def ready_for_setting(store: SqliteStore, client: TestClient) -> dict:
    work = client.post("/api/works", json={"seed": SEED}).json()
    client.post(f"/api/works/{work['id']}/advance")
    creative = store.get_work(work["id"]).artifacts[1]
    client.post(
        f"/api/works/{work['id']}/artifacts/creative/select",
        json={"directionId": creative.content.directions[0].directionId, "expectedHeadVersion": 1},
    )
    client.post(f"/api/works/{work['id']}/advance")
    outline = store.get_work(work["id"]).artifacts[-1]
    client.post(
        f"/api/works/{work['id']}/artifacts/outline/approve",
        json={"expectedArtifactId": outline.id, "expectedHeadVersion": 1},
    )
    client.post(f"/api/works/{work['id']}/advance")
    return work


def artifact_request(artifact: Any, **changes: Any) -> dict:
    return {
        "chapter": artifact.chapter,
        "expectedArtifactId": artifact.id,
        "expectedHeadVersion": artifact.version,
        "content": artifact.content.model_dump(),
        **changes,
    }


def test_special_commands_complete_first_chapter_and_compare(tmp_path: Path) -> None:
    store, application, api = app(tmp_path)
    transport = httpx.MockTransport(
        lambda request: TestClient(application).request(
            request.method, str(request.url), content=request.content, headers=request.headers
        )
    )
    work = ready_for_setting(store, api)
    work_id = work["id"]
    setting = store.get_work(work_id).artifacts[-1]
    setting_file = request_file(
        tmp_path,
        "setting.json",
        {
            "expectedHeadVersion": setting.version,
            "content": {
                **setting.content.model_dump(),
                "overview": setting.content.overview + "\n作者确认的设定。",
            },
        },
    )
    code, approved, _, errors = invoke(
        ["approve-setting", work_id, "--file", setting_file], transport, tmp_path
    )
    assert code == 0, errors
    assert approved["id"] == setting.id and approved["version"] == 1
    assert approved["humanStatus"] == "approved"

    api.post(f"/api/works/{work_id}/advance")
    original = store.get_work(work_id).artifacts[-1]
    regenerated_file = request_file(
        tmp_path,
        "beat.json",
        artifact_request(original, instructions="重新安排冲突"),
    )
    code, regenerated, _, errors = invoke(
        ["regenerate-beat", work_id, "--file", regenerated_file], transport, tmp_path
    )
    assert code == 0, errors
    assert regenerated["artifact"]["version"] == 2
    assert regenerated["artifact"]["humanStatus"] == "pending"
    candidate = store.get_work(work_id).artifacts[-1]
    selection = {
        "chapter": 1,
        "expectedArtifactId": candidate.id,
        "expectedHeadVersion": candidate.version,
        "originalArtifactId": original.id,
        "originalVersion": original.version,
        "originalContent": original.content.model_dump(),
        "choice": "new",
    }
    selection_file = request_file(tmp_path, "variant.json", selection)
    code, compared, _, errors = invoke(
        ["select-beat-variant", work_id, "--file", selection_file], transport, tmp_path
    )
    assert code == 0, errors
    assert compared["selection"]["writeOutcome"] == "not-committed"
    original_file = request_file(
        tmp_path, "variant-original.json", {**selection, "choice": "original"}
    )
    code, selected, _, errors = invoke(
        ["select-beat-variant", work_id, "--file", original_file], transport, tmp_path
    )
    assert code == 0, errors
    assert selected["artifact"]["version"] == 3
    assert selected["artifact"]["content"] == original.content.model_dump()
    current = store.get_work(work_id).artifacts[-1]
    approved_file = request_file(tmp_path, "approve-beat.json", artifact_request(current))
    code, beat_approved, _, errors = invoke(
        ["approve-beat", work_id, "--file", approved_file], transport, tmp_path
    )
    assert code == 0, errors
    assert beat_approved["artifact"]["id"] == current.id
    assert beat_approved["artifact"]["humanStatus"] == "approved"
    assert store.get_artifact_version(work_id, "beat", 1, original.id, 1).humanStatus == "pending"

    api.post(f"/api/works/{work_id}/advance")
    prose = store.get_work(work_id).artifacts[-1]
    prose_file = request_file(
        tmp_path, "regenerate-prose.json", artifact_request(prose, instructions="更具体地写行动")
    )
    code, rewritten, _, errors = invoke(
        ["regenerate-prose", work_id, "--file", prose_file], transport, tmp_path
    )
    assert code == 0, errors
    assert rewritten["artifact"]["version"] == 2
    prose = store.get_work(work_id).artifacts[-1]
    text = "作者修改后的完整第一章正文😀"
    save_file = request_file(
        tmp_path,
        "save-prose.json",
        artifact_request(prose, expectedHumanStatus="pending", content={"text": text}),
    )
    code, saved, _, errors = invoke(
        ["save-prose", work_id, "--file", save_file], transport, tmp_path
    )
    assert code == 0, errors
    assert saved["artifact"]["version"] == 3
    prose = store.get_work(work_id).artifacts[-1]
    approval_file = request_file(tmp_path, "approve-prose.json", artifact_request(prose))
    code, prose_approved, _, errors = invoke(
        ["approve-prose", work_id, "--file", approval_file], transport, tmp_path
    )
    assert code == 0, errors
    assert prose_approved["artifact"]["id"] == prose.id
    assert prose_approved["artifact"]["humanStatus"] == "approved"
    edit_file = request_file(
        tmp_path,
        "edit-approved.json",
        artifact_request(
            prose,
            expectedHumanStatus="approved",
            content={"text": text + "\n作者通过后再次编辑。"},
        ),
    )
    code, edited, _, errors = invoke(
        ["save-prose", work_id, "--file", edit_file], transport, tmp_path
    )
    assert code == 0, errors
    assert edited["artifact"]["version"] == 4
    assert edited["artifact"]["humanStatus"] == "approved"
    assert api.get(f"/api/works/{work_id}").json()["workflowState"] == "prose-approved"
    store.close()


class ResponseFailure(httpx.BaseTransport):
    def __init__(self, application: Any, suffix: str, commit: bool) -> None:
        self.client = TestClient(application)
        self.suffix = suffix
        self.commit = commit
        self.posts = 0
        self.gets = 0

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith(self.suffix):
            self.posts += 1
            if self.commit:
                response = self.client.request(
                    request.method,
                    str(request.url),
                    content=request.content,
                    headers=request.headers,
                )
                assert response.status_code == 200, response.text
            return httpx.Response(
                500,
                json={
                    "code": "internal-error",
                    "message": "response unavailable",
                    "retryable": False,
                },
                request=request,
            )
        if request.method == "GET":
            self.gets += 1
        return self.client.request(
            request.method, str(request.url), content=request.content, headers=request.headers
        )


def pending_prose(tmp_path: Path):
    store, application, api = app(tmp_path)
    work = ready_for_beat(api, store, tmp_path)
    api.post(f"/api/works/{work['id']}/advance")
    beat = store.get_work(work["id"]).artifacts[-1]
    approved = api.post(
        f"/api/works/{work['id']}/artifacts/beat/approve",
        json=artifact_request(beat),
    )
    assert approved.status_code == 200
    api.post(f"/api/works/{work['id']}/advance")
    return store, application, work, store.get_work(work["id"]).artifacts[-1]


def test_prose_commit_then_500_is_confirmed_by_one_readback(tmp_path: Path) -> None:
    store, application, work, prose = pending_prose(tmp_path)
    transport = ResponseFailure(application, "/artifacts/prose/approve", True)
    approval = request_file(tmp_path, "approve.json", artifact_request(prose))
    code, result, _, errors = invoke(
        ["approve-prose", work["id"], "--file", approval], transport, tmp_path
    )
    assert code == 0, errors
    assert result["confirmedBy"] == "read-work"
    assert result["artifact"]["id"] == prose.id
    assert result["artifact"]["humanStatus"] == "approved"
    assert transport.posts == 1 and transport.gets == 2
    store.close()


def test_prose_500_without_confirmation_stays_unknown(tmp_path: Path) -> None:
    store, application, work, prose = pending_prose(tmp_path)
    transport = ResponseFailure(application, "/artifacts/prose/approve", False)
    approval = request_file(tmp_path, "approve.json", artifact_request(prose))
    code, result, _, _ = invoke(
        ["approve-prose", work["id"], "--file", approval], transport, tmp_path
    )
    assert code == 1
    assert result["code"] == "prose-result-unknown"
    assert result["details"]["hasUnknownWrite"] is True
    assert result["details"]["nextActions"] == ["read-work", "retry-frozen-request"]
    assert transport.posts == 1 and transport.gets == 2
    assert store.get_work(work["id"]).artifacts[-1].humanStatus == "pending"
    store.close()


def test_setting_commit_then_500_is_confirmed_once(tmp_path: Path) -> None:
    store, application, api = app(tmp_path)
    work = ready_for_setting(store, api)
    setting = store.get_work(work["id"]).artifacts[-1]
    transport = ResponseFailure(application, "/artifacts/setting/approve", True)
    approval = request_file(
        tmp_path,
        "setting.json",
        {
            "expectedHeadVersion": 1,
            "content": {**setting.content.model_dump(), "overview": "作者确认的完整设定"},
        },
    )
    code, result, _, errors = invoke(
        ["approve-setting", work["id"], "--file", approval], transport, tmp_path
    )
    assert code == 0, errors
    assert result["id"] == setting.id
    assert result["humanStatus"] == "approved"
    assert transport.posts == 1 and transport.gets == 2
    code, result, _, _ = invoke(
        ["approve-setting", work["id"], "--file", approval], transport, tmp_path
    )
    assert code == 1 and result["code"] == "artifact-already-approved"
    assert transport.posts == 1
    store.close()
