import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from resource_fixtures import CONFIG_REQUEST_ID
from test_resource_writes import REQUEST_ID, approved_setting, extension
from work_fixtures import BEAT

from agent4novel.domain.resources import SettingExtensionActionRequest
from agent4novel.main import create_app
from agent4novel.store.resources import SqliteResourceStore


def test_extension_pending_guard_and_atomic_rollback(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    work, detail = approved_setting(store)
    base = next(a for a in detail.artifacts if a.kind == "setting")
    request = extension(base)
    beat = store.append_artifact(work.id, "beat", BEAT, chapter=1)
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, store=store))
    path = f"/api/works/{work.id}/setting-extensions"
    blocked = client.post(path, json=request)
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "setting-extension-chapter-pending"
    store.finalize_artifact(
        work.id,
        "beat",
        chapter=1,
        expected_artifact_id=beat.id,
        expected_head_version=1,
        content=BEAT,
    )
    assert client.post(path, json=request).status_code == 201
    store.append_artifact(work.id, "beat", BEAT, chapter=2)
    blocked = client.post(
        f"{path}/{REQUEST_ID}/approve",
        json={"requestId": REQUEST_ID, "expectedBase": request["expectedBase"]},
    )
    assert blocked.status_code == 409
    store.db.execute(
        "UPDATE artifacts SET human_status = 'approved' WHERE kind = 'beat' AND chapter = 2"
    )
    original = store._put_extension

    def fail_after_record(record):
        original(record)
        if record.status == "approved":
            raise sqlite3.OperationalError("synthetic storage failure")

    store._put_extension = fail_after_record
    with pytest.raises(sqlite3.OperationalError):
        store.approve_setting_extension(
            work.id,
            SettingExtensionActionRequest(
                requestId=REQUEST_ID, expectedBase=request["expectedBase"]
            ),
        )
    assert not store.db.in_transaction
    assert store.get_setting_extension(work.id, REQUEST_ID).status == "pending"
    assert store._head(work.id, "setting", None)["version"] == 1
    assert (
        store.db.execute("SELECT COUNT(*) FROM artifacts WHERE kind = 'setting'").fetchone()[0] == 1
    )
    store.close()


def test_extension_raw_limit_body_limit_and_action_path(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    work, detail = approved_setting(store)
    base = next(a for a in detail.artifacts if a.kind == "setting")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, store=store))
    path = f"/api/works/{work.id}/setting-extensions"
    oversized = extension(base)
    oversized["extension"]["title"] = " " * 2 + "x" * 255
    response = client.post(path, json=oversized)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "setting-extension-limit"
    assert (
        client.post(
            f"{path}/{REQUEST_ID}/approve",
            json={"requestId": REQUEST_ID, "expectedBase": extension(base)["expectedBase"]},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{path}/not-a-uuid/approve",
            json={"requestId": REQUEST_ID, "expectedBase": extension(base)["expectedBase"]},
        ).status_code
        == 400
    )
    too_large = client.post(path, content=b" " * (2 * 1024 * 1024 + 1))
    assert too_large.status_code == 413
    store.close()


def test_yaml_aliases_and_duplicate_keys_are_rejected(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, store=store))
    work = client.post("/api/works", json={"seed": "合成测试脑洞"}).json()
    for frontmatter in (
        "name: &name plain-writing\ndescription: *name",
        "name: plain-writing\ndescription: 简洁\nname: duplicate",
    ):
        response = client.post(
            f"/api/works/{work['id']}/agent-files",
            json={
                "requestId": CONFIG_REQUEST_ID,
                "kind": "skill",
                "text": f"---\n{frontmatter}\n---\n正文\n",
            },
        )
        assert response.status_code == 400, response.text
        assert response.json()["code"] == "config-invalid"
    assert store.list_agent_files(work["id"]) == []
    store.close()


def test_concurrent_replays_across_connections(tmp_path: Path) -> None:
    from concurrent.futures import ThreadPoolExecutor

    from agent4novel.domain.resources import SettingExtensionProposeRequest

    path = tmp_path / "agent4novel.sqlite"
    first = SqliteResourceStore(path)
    second = SqliteResourceStore(path)
    work, detail = approved_setting(first)
    base = next(a for a in detail.artifacts if a.kind == "setting")
    request = SettingExtensionProposeRequest.model_validate(extension(base))
    with ThreadPoolExecutor(max_workers=2) as pool:
        proposals = list(
            pool.map(
                lambda store: store.propose_setting_extension(work.id, request),
                (first, second),
            )
        )
    assert proposals[0] == proposals[1]
    assert first.db.execute("SELECT COUNT(*) FROM setting_extension_proposals").fetchone()[0] == 1
    action = SettingExtensionActionRequest(requestId=REQUEST_ID, expectedBase=request.expectedBase)
    with ThreadPoolExecutor(max_workers=2) as pool:
        approvals = list(
            pool.map(
                lambda store: store.approve_setting_extension(work.id, action),
                (first, second),
            )
        )
    assert approvals[0] == approvals[1]
    assert (
        first.db.execute("SELECT COUNT(*) FROM artifacts WHERE kind = 'setting'").fetchone()[0] == 2
    )
    assert first.get_setting_extension(work.id, REQUEST_ID).status == "approved"
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, store=first))
    assert (
        client.post(f"/api/works/{work.id}/bad-examples", content=b" " * 196_609).status_code == 413
    )
    first.close()
    second.close()
