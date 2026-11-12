import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
from work_fixtures import SEED, SETTING

from agent4novel.main import create_app
from agent4novel.store.resources import SqliteResourceStore

REQUEST_ID = "55555555-5555-4555-8555-555555555555"
OTHER_ID = "66666666-6666-4666-8666-666666666666"


def approved_setting(store: SqliteResourceStore):
    work = store.create_work(SEED)
    setting = store.append_artifact(work.id, "setting", SETTING)
    store.finalize_artifact(
        work.id,
        "setting",
        chapter=None,
        expected_artifact_id=setting.id,
        expected_head_version=setting.version,
        content=SETTING,
    )
    return work, store.get_work(work.id)


def extension(base, request_id=REQUEST_ID):
    return {
        "requestId": request_id,
        "expectedBase": {"artifactId": base.id, "version": base.version},
        "extension": {
            "title": " 新势力 ",
            "items": [{"title": " 守夜人 ", "content": " 维护夜城秩序 "}],
        },
    }


def test_setting_extension_lifecycle_and_replays(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    work, detail = approved_setting(store)
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, store=store))
    base = next(a for a in detail.artifacts if a.kind == "setting")
    path = f"/api/works/{work.id}/setting-extensions"
    created = client.post(path, json=extension(base))
    assert created.status_code == 201, created.text
    assert created.json()["operation"] == "propose"
    assert created.json()["writeOutcome"] == "committed"
    assert client.post(path, json=extension(base)).json() == created.json()
    conflict = extension(base)
    conflict["extension"]["title"] = "另一种设定"
    assert client.post(path, json=conflict).status_code == 409
    resource = client.get(f"{path}/{REQUEST_ID}").json()
    assert resource["status"] == "pending"
    assert resource["extension"]["title"] == "新势力"
    assert resource["extension"]["items"][0]["title"] == "守夜人"

    approved = client.post(
        f"{path}/{REQUEST_ID}/approve",
        json={"requestId": REQUEST_ID, "expectedBase": extension(base)["expectedBase"]},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["candidate"]["version"] == 2
    assert (
        client.post(
            f"{path}/{REQUEST_ID}/approve",
            json={"requestId": REQUEST_ID, "expectedBase": extension(base)["expectedBase"]},
        ).json()
        == approved.json()
    )
    head = next(a for a in store.get_work(work.id).artifacts if a.kind == "setting")
    assert head.version == 2 and head.humanStatus == "approved"
    assert head.inputs[0].artifactId == base.id
    assert head.content.extensions[-1].title == "新势力"
    assert client.get(f"{path}/{REQUEST_ID}").json()["status"] == "approved"
    conflict = client.post(
        f"{path}/{REQUEST_ID}/cancel",
        json={"requestId": REQUEST_ID, "expectedBase": extension(base)["expectedBase"]},
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "setting-extension-state-conflict"
    store.close()


def test_setting_extension_stale_cancel_and_no_artifact(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    work, detail = approved_setting(store)
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, store=store))
    base = next(a for a in detail.artifacts if a.kind == "setting")
    path = f"/api/works/{work.id}/setting-extensions"
    assert client.post(path, json=extension(base)).status_code == 201
    other = extension(base, OTHER_ID)
    other["extension"]["title"] = "另一个扩展"
    assert client.post(path, json=other).status_code == 201
    assert (
        client.post(
            f"{path}/{OTHER_ID}/approve",
            json={"requestId": OTHER_ID, "expectedBase": other["expectedBase"]},
        ).status_code
        == 200
    )
    assert client.get(f"{path}/{REQUEST_ID}").json()["status"] == "stale"
    assert (
        client.post(
            f"{path}/{REQUEST_ID}/approve",
            json={"requestId": REQUEST_ID, "expectedBase": extension(base)["expectedBase"]},
        ).status_code
        == 409
    )
    cancelled = client.post(
        f"{path}/{REQUEST_ID}/cancel",
        json={"requestId": REQUEST_ID, "expectedBase": extension(base)["expectedBase"]},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert client.get(f"{path}/{REQUEST_ID}").json()["status"] == "cancelled"
    assert len([a for a in store.get_work(work.id).artifacts if a.kind == "setting"]) == 1
    store.close()


def test_bad_example_utf16_snapshot_replay_and_history(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    work = store.create_work(SEED)
    prose = store.append_artifact(work.id, "prose", {"text": "开头😀中段，结尾"}, chapter=1)
    source_hash = hashlib.sha256(prose.content.text.encode()).hexdigest()
    selection = {
        "requestId": REQUEST_ID,
        "chapter": 1,
        "sourceArtifactId": prose.id,
        "sourceVersion": prose.version,
        "sourceHash": source_hash,
        "start": 2,
        "end": 6,
        "text": "😀中段",
        "note": "检查口吻",
    }
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, store=store))
    path = f"/api/works/{work.id}/bad-examples"
    saved = client.post(path, json=selection)
    assert saved.status_code == 200, saved.text
    assert saved.json()["id"] == REQUEST_ID
    assert client.post(path, json=selection).json() == saved.json()
    assert client.post(path, json={**selection, "note": "改变"}).status_code == 409
    updated = store.save_artifact(
        work.id,
        "prose",
        chapter=1,
        expected_artifact_id=prose.id,
        expected_head_version=1,
        expected_human_status="pending",
        content={"text": "已经重写"},
    )
    assert updated.version == 2
    assert client.get(f"{path}/{REQUEST_ID}").json()["text"] == "😀中段"
    old_source = {**selection, "requestId": OTHER_ID}
    assert client.post(path, json=old_source).status_code == 200
    missing = {
        **selection,
        "requestId": "77777777-7777-4777-8777-777777777777",
        "sourceArtifactId": updated.id,
        "sourceVersion": 2,
    }
    assert client.post(path, json=missing).status_code == 400
    assert client.get(f"{path}?chapter=1").json()["items"][0]["text"] == "😀中段"
    store.close()
