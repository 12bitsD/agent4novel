from pathlib import Path

from fastapi.testclient import TestClient
from test_beat_pipeline import ready_for_beat

from agent4novel.main import create_app
from agent4novel.store.work import SqliteStore


def approve_current_beat(client: TestClient, store: SqliteStore, work: dict) -> None:
    generated = client.post(f"/api/works/{work['id']}/advance")
    assert generated.status_code == 200, generated.text
    assert generated.json()["stepId"] == "beat"
    beat = store.get_work(work["id"]).artifacts[-1]
    response = client.post(
        f"/api/works/{work['id']}/artifacts/beat/approve",
        json={
            "chapter": 1,
            "expectedArtifactId": beat.id,
            "expectedHeadVersion": beat.version,
            "content": beat.content.model_dump(),
        },
    )
    assert response.status_code == 200, response.text


def test_complete_first_chapter_save_approve_and_edit(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = ready_for_beat(client, store, tmp_path)
    approve_current_beat(client, store, work)

    generated = client.post(f"/api/works/{work['id']}/advance")
    assert generated.status_code == 200, generated.text
    outcome = generated.json()
    assert outcome["kind"] == "advanced"
    assert outcome["stepId"] == "prose"
    assert outcome["proseCommand"]["writeOutcome"] == "committed"
    assert outcome["proseCommand"]["expectedHead"] is None
    prose = store.get_work(work["id"]).artifacts[-1]
    assert prose.kind == "prose"
    assert prose.humanStatus == "pending"
    assert [ref.kind for ref in prose.inputs] == ["beat", "setting"]

    saved = client.post(
        f"/api/works/{work['id']}/artifacts/prose/save",
        json={
            "chapter": 1,
            "expectedArtifactId": prose.id,
            "expectedHeadVersion": 1,
            "expectedHumanStatus": "pending",
            "content": {"text": "作者修改后的完整第一章正文。"},
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["artifact"]["version"] == 2
    assert saved.json()["artifact"]["humanStatus"] == "pending"
    assert saved.json()["artifact"]["id"] != prose.id
    assert saved.json()["command"]["expectedHead"]["humanStatus"] == "pending"
    assert saved.json()["command"]["attemptIds"] == []

    approved = client.post(
        f"/api/works/{work['id']}/artifacts/prose/approve",
        json={
            "chapter": 1,
            "expectedArtifactId": saved.json()["artifact"]["id"],
            "expectedHeadVersion": 2,
            "content": {"text": "作者修改后的完整第一章正文。"},
        },
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["artifact"]["id"] == saved.json()["artifact"]["id"]
    assert approved.json()["artifact"]["version"] == 2
    assert approved.json()["artifact"]["humanStatus"] == "approved"
    assert approved.json()["command"]["writeOutcome"] == "committed"
    assert approved.json()["workflow"]["workflowState"] == "prose-approved"

    edited = client.post(
        f"/api/works/{work['id']}/artifacts/prose/save",
        json={
            "chapter": 1,
            "expectedArtifactId": saved.json()["artifact"]["id"],
            "expectedHeadVersion": 2,
            "expectedHumanStatus": "approved",
            "content": {"text": "通过后再次编辑的完整正文。"},
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["artifact"]["version"] == 3
    assert edited.json()["artifact"]["humanStatus"] == "approved"
    assert edited.json()["artifact"]["content"]["text"] == "通过后再次编辑的完整正文。"
    assert edited.json()["command"]["resultHead"]["humanStatus"] == "approved"
    assert edited.json()["artifact"]["inputs"]
    view = client.get(f"/api/works/{work['id']}").json()
    assert view["workflowState"] == "prose-approved"
    assert view["currentChapter"] == 1
    assert len(view["chapters"]) == 1
    store.close()

    reopened = SqliteStore(tmp_path / "agent4novel.sqlite")
    stored = reopened.get_work(work["id"])
    assert stored is not None
    assert [artifact.kind for artifact in stored.artifacts] == [
        "caption",
        "creative",
        "outline",
        "setting",
        "beat",
        "prose",
    ]
    assert stored.artifacts[-1].content.text == "通过后再次编辑的完整正文。"
    assert stored.artifacts[-1].version == 3
    assert stored.artifacts[-1].humanStatus == "approved"
    reopened.close()


def test_pending_prose_regeneration_and_empty_approved_rejection(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = ready_for_beat(client, store, tmp_path)
    approve_current_beat(client, store, work)
    client.post(f"/api/works/{work['id']}/advance")
    baseline = store.get_work(work["id"]).artifacts[-1]

    regenerated = client.post(
        f"/api/works/{work['id']}/artifacts/prose/regenerate",
        json={
            "chapter": 1,
            "expectedArtifactId": baseline.id,
            "expectedHeadVersion": 1,
            "content": {"text": ""},
            "instructions": "加强动作与结果",
        },
    )
    assert regenerated.status_code == 200, regenerated.text
    body = regenerated.json()
    assert body["artifact"]["version"] == 2
    assert body["artifact"]["humanStatus"] == "pending"
    assert body["command"]["operation"] == "regenerate-prose"
    assert body["command"]["writeOutcome"] == "committed"
    assert "加强动作与结果" in body["artifact"]["content"]["text"]

    approved = client.post(
        f"/api/works/{work['id']}/artifacts/prose/approve",
        json={
            "chapter": 1,
            "expectedArtifactId": body["artifact"]["id"],
            "expectedHeadVersion": 2,
            "content": body["artifact"]["content"],
        },
    )
    assert approved.status_code == 200, approved.text
    rejected = client.post(
        f"/api/works/{work['id']}/artifacts/prose/save",
        json={
            "chapter": 1,
            "expectedArtifactId": body["artifact"]["id"],
            "expectedHeadVersion": 2,
            "expectedHumanStatus": "approved",
            "content": {"text": "  "},
        },
    )
    assert rejected.status_code == 422, rejected.text
    failure = rejected.json()
    assert failure["code"] == "invalid-content"
    assert failure["command"]["writeOutcome"] == "not-committed"
    assert failure["command"]["failureStage"] == "input"
    assert store.get_work(work["id"]).artifacts[-1].version == 2
    store.close()


def test_prose_rejected_request_shape(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = ready_for_beat(client, store, tmp_path)
    response = client.post(
        f"/api/works/{work['id']}/artifacts/prose/approve",
        content="{",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "bad-json"
    assert body["command"]["kind"] == "request-rejected"
    assert body["command"]["writeOutcome"] == "not-committed"
    assert body["command"]["attemptIds"] == []
    assert store.get_work(work["id"]).artifacts[-1].kind == "setting"
    store.close()
