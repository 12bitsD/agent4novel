from pathlib import Path

from fastapi.testclient import TestClient
from work_fixtures import SEED

from agent4novel.main import create_app
from agent4novel.store.work import SqliteStore


def ready_for_beat(client: TestClient, store: SqliteStore, tmp_path: Path) -> dict:
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
        json={"expectedArtifactId": outline.id, "expectedHeadVersion": outline.version},
    )
    client.post(f"/api/works/{work['id']}/advance")
    setting = store.get_work(work["id"]).artifacts[-1]
    client.post(
        f"/api/works/{work['id']}/artifacts/setting/approve",
        json={"content": setting.content.model_dump(), "expectedHeadVersion": 1},
    )
    return work


def test_beat_generate_approve_regenerate_and_variant(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = ready_for_beat(client, store, tmp_path)

    generated = client.post(f"/api/works/{work['id']}/advance")
    assert generated.status_code == 200, generated.text
    outcome = generated.json()
    assert outcome["kind"] == "advanced"
    assert outcome["stepId"] == "beat"
    assert outcome["beatCommand"]["operation"] == "generate-beat"
    assert outcome["beatCommand"]["writeOutcome"] == "committed"
    assert outcome["beatCommand"]["expectedHead"] is None
    beat = store.get_work(work["id"]).artifacts[-1]
    assert beat.kind == "beat"
    assert beat.chapter == 1
    assert beat.humanStatus == "pending"
    assert beat.inputs[0].kind == "outline"
    assert beat.inputs[1].kind == "setting"

    content = beat.content.model_dump()
    content["writingPlan"][0]["content"] = "作者修改后的写作安排"
    approved = client.post(
        f"/api/works/{work['id']}/artifacts/beat/approve",
        json={
            "chapter": 1,
            "expectedArtifactId": beat.id,
            "expectedHeadVersion": 1,
            "content": content,
        },
    )
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["artifact"]["id"] == beat.id
    assert body["artifact"]["version"] == 1
    assert body["artifact"]["humanStatus"] == "approved"
    assert body["command"]["writeOutcome"] == "committed"
    assert body["command"]["attemptIds"] == []
    assert body["workflow"]["nextStepId"] == "prose"
    assert (
        store.get_work(work["id"]).artifacts[-1].content.writingPlan[0].content
        == "作者修改后的写作安排"
    )

    regenerated = client.post(
        f"/api/works/{work['id']}/artifacts/beat/regenerate",
        json={
            "chapter": 1,
            "expectedArtifactId": beat.id,
            "expectedHeadVersion": 1,
            "content": {
                **content,
                "writingPlan": [
                    {"title": "待完善", "content": ""},
                    *content["writingPlan"][1:],
                ],
            },
            "instructions": "重新安排冲突",
        },
    )
    # Approved Beat is not the ordinary regeneration baseline.
    assert regenerated.status_code == 409, regenerated.text

    pending = client.post(
        f"/api/works/{work['id']}/artifacts/beat/regenerate",
        json={
            "chapter": 1,
            "expectedArtifactId": beat.id,
            "expectedHeadVersion": 1,
            "content": content,
            "instructions": "重新安排冲突",
        },
    )
    assert pending.status_code == 409


def test_beat_pending_regeneration_and_original_selection(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = ready_for_beat(client, store, tmp_path)
    client.post(f"/api/works/{work['id']}/advance")
    baseline = store.get_work(work["id"]).artifacts[-1]
    request = {
        "chapter": 1,
        "expectedArtifactId": baseline.id,
        "expectedHeadVersion": 1,
        "content": baseline.content.model_dump(),
        "instructions": "让选择更有代价",
    }
    regenerated = client.post(f"/api/works/{work['id']}/artifacts/beat/regenerate", json=request)
    assert regenerated.status_code == 200, regenerated.text
    body = regenerated.json()
    assert body["artifact"]["version"] == 2
    assert body["artifact"]["humanStatus"] == "pending"
    assert body["comparison"]["original"]["id"] == baseline.id
    assert body["comparison"]["candidate"]["id"] == body["artifact"]["id"]
    assert body["command"]["operation"] == "regenerate-beat"
    assert body["command"]["writeOutcome"] == "committed"
    assert body["workflow"]["workflowState"] == "awaiting-beat-review"

    choose_new = client.post(
        f"/api/works/{work['id']}/artifacts/beat/select",
        json={
            "chapter": 1,
            "expectedArtifactId": body["artifact"]["id"],
            "expectedHeadVersion": 2,
            "originalArtifactId": baseline.id,
            "originalVersion": 1,
            "originalContent": baseline.content.model_dump(),
            "choice": "new",
        },
    )
    assert choose_new.status_code == 200, choose_new.text
    assert choose_new.json()["selection"]["writeOutcome"] == "not-committed"

    choose_original = client.post(
        f"/api/works/{work['id']}/artifacts/beat/select",
        json={
            "chapter": 1,
            "expectedArtifactId": body["artifact"]["id"],
            "expectedHeadVersion": 2,
            "originalArtifactId": baseline.id,
            "originalVersion": 1,
            "originalContent": baseline.content.model_dump(),
            "choice": "original",
        },
    )
    assert choose_original.status_code == 200, choose_original.text
    assert choose_original.json()["artifact"]["version"] == 3
    assert choose_original.json()["artifact"]["content"] == baseline.content.model_dump()
    assert choose_original.json()["selection"]["writeOutcome"] == "committed"
    assert choose_original.json()["artifact"]["id"] != body["artifact"]["id"]
    store.close()


def test_beat_invalid_content_is_command_failure_without_write(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = ready_for_beat(client, store, tmp_path)
    client.post(f"/api/works/{work['id']}/advance")
    beat = store.get_work(work["id"]).artifacts[-1]
    content = beat.content.model_dump()
    content["writingPlan"][0]["itemId"] = "unknown-id"
    response = client.post(
        f"/api/works/{work['id']}/artifacts/beat/approve",
        json={
            "chapter": 1,
            "expectedArtifactId": beat.id,
            "expectedHeadVersion": 1,
            "content": content,
        },
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "invalid-content"
    assert body["command"]["writeOutcome"] == "not-committed"
    assert body["command"]["failureStage"] == "input"
    assert body["command"]["attemptIds"] == []
    assert store.get_work(work["id"]).artifacts[-1].humanStatus == "pending"
    assert store.get_work(work["id"]).artifacts[-1].version == 1
    store.close()
