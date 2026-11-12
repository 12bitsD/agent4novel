from pathlib import Path

from fastapi.testclient import TestClient
from work_fixtures import SEED

from agent4novel.main import create_app
from agent4novel.store.work import SqliteStore


def test_outline_and_setting_review_pipeline(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = client.post("/api/works", json={"seed": SEED}).json()
    assert client.post(f"/api/works/{work['id']}/advance").json()["stepId"] == "creative"
    creative = store.get_work(work["id"]).artifacts[1]
    selected = client.post(
        f"/api/works/{work['id']}/artifacts/creative/select",
        json={"directionId": creative.content.directions[0].directionId, "expectedHeadVersion": 1},
    )
    assert selected.status_code == 200, selected.text

    outline_result = client.post(f"/api/works/{work['id']}/advance")
    assert outline_result.status_code == 200, outline_result.text
    assert outline_result.json()["kind"] == "advanced"
    assert outline_result.json()["stepId"] == "outline"
    outline = store.get_work(work["id"]).artifacts[-1]
    assert outline.kind == "outline"
    assert outline.humanStatus == "pending"
    assert len(outline.content.arcs) == 3
    assert outline.content.arcs[0].arcId == f"{work['id']}-arc-1"

    draft = outline.content.model_dump()
    draft["arcs"].append(
        {
            "title": "作者新增弧线",
            "conflict": "新增冲突",
            "development": "新增发展",
            "resolution": "新增收束",
            "segments": [
                {"title": "第一点", "summary": "发生", "outcome": "变化"},
                {"title": "第二点", "summary": "推进", "outcome": "新局面"},
            ],
        }
    )
    saved = client.put(
        f"/api/works/{work['id']}/artifacts/outline",
        json={"expectedHeadVersion": 1, "content": draft},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == 2
    assert saved.json()["humanStatus"] == "pending"
    assert saved.json()["content"]["arcs"][3]["arcId"] == f"{work['id']}-arc-4"
    segment_ids = [
        segment["segmentId"]
        for arc in saved.json()["content"]["arcs"]
        for segment in arc["segments"]
    ]
    assert len(segment_ids) == len(set(segment_ids))

    wrong = client.post(
        f"/api/works/{work['id']}/artifacts/outline/approve",
        json={"expectedArtifactId": "wrong-id", "expectedHeadVersion": 2},
    )
    assert wrong.status_code == 409
    approved = client.post(
        f"/api/works/{work['id']}/artifacts/outline/approve",
        json={"expectedArtifactId": saved.json()["id"], "expectedHeadVersion": 2},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["id"] == saved.json()["id"]
    assert approved.json()["version"] == 2
    assert approved.json()["humanStatus"] == "approved"
    assert approved.json()["createdAt"] == saved.json()["createdAt"]

    setting_result = client.post(f"/api/works/{work['id']}/advance")
    assert setting_result.status_code == 200, setting_result.text
    assert setting_result.json()["stepId"] == "setting"
    setting = store.get_work(work["id"]).artifacts[-1]
    assert setting.kind == "setting"
    assert setting.humanStatus == "pending"
    assert setting.content.world[0].itemId.startswith("item-")

    bad_content = setting.content.model_dump()
    bad_content["world"][0]["itemId"] = "does-not-belong"
    rejected = client.post(
        f"/api/works/{work['id']}/artifacts/setting/approve",
        json={"content": bad_content, "expectedHeadVersion": 1},
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["code"] == "invalid-content"
    assert store.get_work(work["id"]).artifacts[-1].humanStatus == "pending"

    content = setting.content.model_dump()
    content["world"].append({"title": "作者补充", "content": "新增的世界规则"})
    approved_setting = client.post(
        f"/api/works/{work['id']}/artifacts/setting/approve",
        json={"content": content, "expectedHeadVersion": 1},
    )
    assert approved_setting.status_code == 200, approved_setting.text
    assert approved_setting.json()["id"] == setting.id
    assert approved_setting.json()["version"] == 1
    assert approved_setting.json()["createdAt"] == setting.createdAt
    assert approved_setting.json()["humanStatus"] == "approved"
    assert approved_setting.json()["content"]["world"][-1]["itemId"].startswith("item-")

    repeated = client.post(
        f"/api/works/{work['id']}/artifacts/setting/approve",
        json={"content": content, "expectedHeadVersion": 1},
    )
    assert repeated.status_code == 409
    assert repeated.json()["code"] == "artifact-already-approved"
    view = client.get(f"/api/works/{work['id']}").json()
    assert view["workflowState"] == "ready-to-generate"
    assert view["nextStepId"] == "beat"
    store.close()

    reopened = SqliteStore(tmp_path / "agent4novel.sqlite")
    stored = reopened.get_work(work["id"])
    assert stored is not None
    assert [artifact.kind for artifact in stored.artifacts] == [
        "caption",
        "creative",
        "outline",
        "setting",
    ]
    assert stored.artifacts[-1].content.world[-1].title == "作者补充"
    assert stored.artifacts[-1].humanStatus == "approved"
    reopened.close()
