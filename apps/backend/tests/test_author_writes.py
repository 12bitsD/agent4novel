import hashlib
import stat
from pathlib import Path

from fastapi.testclient import TestClient
from resource_fixtures import CONFIG_REQUEST_ID, SKILL_ID, SKILL_TEXT
from work_fixtures import SEED

from agent4novel.main import create_app
from agent4novel.store.resources import SqliteResourceStore

ANOTHER_REQUEST = "55555555-5555-4555-8555-555555555555"


def app(tmp_path: Path):
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(
        create_app(
            {"A4N_DATA_DIR": str(tmp_path), "KIMI_API_KEY": "synthetic"},
            root=tmp_path,
            store=store,
        )
    )
    work = client.post("/api/works", json={"seed": SEED}).json()
    return store, client, work


def document() -> dict:
    return {
        "preferences": {"style": "简洁", "genre": "都市", "payoff": "成长"},
        "defaults": {"model": "kimi:kimi-k2.8-highspeed", "temperature": 0.25, "topP": 0.8},
        "steps": {"caption": {"directionCount": 1}, "prose": {"skills": [SKILL_ID]}},
    }


def test_config_cas_upload_and_immutable_file(tmp_path: Path) -> None:
    store, client, work = app(tmp_path)
    prompt = client.post(
        f"/api/works/{work['id']}/agent-files",
        json={"requestId": CONFIG_REQUEST_ID, "kind": "prompt", "text": "Use concrete actions."},
    )
    assert prompt.status_code == 200, prompt.text
    skill = client.post(
        f"/api/works/{work['id']}/agent-files",
        json={"requestId": SKILL_ID, "kind": "skill", "text": SKILL_TEXT},
    )
    assert skill.status_code == 200, skill.text
    saved = client.put(
        f"/api/works/{work['id']}/agent-config",
        json={"requestId": CONFIG_REQUEST_ID, "expectedRevision": 0, "document": document()},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1
    replay = client.put(
        f"/api/works/{work['id']}/agent-config",
        json={"requestId": CONFIG_REQUEST_ID, "expectedRevision": 0, "document": document()},
    )
    assert replay.status_code == 200
    assert replay.json()["revision"] == 1
    conflict = client.put(
        f"/api/works/{work['id']}/agent-config",
        json={"requestId": ANOTHER_REQUEST, "expectedRevision": 0, "document": document()},
    )
    assert conflict.status_code == 409
    second = client.put(
        f"/api/works/{work['id']}/agent-config",
        json={"requestId": ANOTHER_REQUEST, "expectedRevision": 1, "document": document()},
    )
    assert second.status_code == 200, second.text
    assert second.json()["revision"] == 2
    effective = client.get(f"/api/works/{work['id']}/agent-config")
    assert effective.status_code == 200, effective.text
    assert effective.json()["revision"] == 2
    assert effective.json()["effective"][0]["directionCount"] == 1
    assert effective.json()["effective"][5]["skills"][0]["id"] == SKILL_ID
    assert effective.json()["effective"][5]["appliedPreferences"] == {
        "style": "简洁",
        "genre": "都市",
        "payoff": "成长",
    }
    content = client.get(f"/api/works/{work['id']}/agent-files/{SKILL_ID}")
    assert content.status_code == 200, content.text
    assert content.json()["text"] == SKILL_TEXT
    target = (
        tmp_path
        / "prompts"
        / hashlib.sha256(work["id"].encode()).hexdigest()
        / SKILL_ID
        / "plain-writing"
        / "SKILL.md"
    )
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert stat.S_IMODE(target.parent.stat().st_mode) == 0o700
    store.close()


def test_upload_replay_conflicts_yaml_and_tampering(tmp_path: Path) -> None:
    store, client, work = app(tmp_path)
    first = client.post(
        f"/api/works/{work['id']}/agent-files",
        json={"requestId": SKILL_ID, "kind": "skill", "text": SKILL_TEXT},
    )
    assert first.status_code == 200, first.text
    replay = client.post(
        f"/api/works/{work['id']}/agent-files",
        json={"requestId": SKILL_ID, "kind": "skill", "text": SKILL_TEXT},
    )
    assert replay.status_code == 200
    changed = client.post(
        f"/api/works/{work['id']}/agent-files",
        json={"requestId": SKILL_ID, "kind": "skill", "text": SKILL_TEXT + "changed"},
    )
    assert changed.status_code == 409
    invalid = client.post(
        f"/api/works/{work['id']}/agent-files",
        json={
            "requestId": ANOTHER_REQUEST,
            "kind": "skill",
            "text": "---\nname: Invalid\n---\nbody\n",
        },
    )
    assert invalid.status_code == 400
    target = (
        tmp_path
        / "prompts"
        / hashlib.sha256(work["id"].encode()).hexdigest()
        / SKILL_ID
        / "plain-writing"
        / "SKILL.md"
    )
    target.write_text("changed")
    unavailable = client.get(f"/api/works/{work['id']}/agent-files/{SKILL_ID}")
    assert unavailable.status_code == 404
    assert unavailable.json()["code"] == "agent-file-unavailable"
    store.close()


def test_file_symlink_is_rejected(tmp_path: Path) -> None:
    store, client, work = app(tmp_path)
    uploaded = client.post(
        f"/api/works/{work['id']}/agent-files",
        json={"requestId": SKILL_ID, "kind": "skill", "text": SKILL_TEXT},
    )
    assert uploaded.status_code == 200, uploaded.text
    managed = tmp_path / "prompts" / hashlib.sha256(work["id"].encode()).hexdigest() / SKILL_ID
    external = tmp_path / "external"
    external.mkdir()
    (external / "plain-writing").mkdir()
    (external / "plain-writing" / "SKILL.md").write_text(SKILL_TEXT)
    managed.rename(managed.parent / "backup")
    managed.symlink_to(external, target_is_directory=True)
    response = client.get(f"/api/works/{work['id']}/agent-files/{SKILL_ID}")
    assert response.status_code == 404
    store.close()


def test_missing_file_reference_does_not_advance_revision(tmp_path: Path) -> None:
    store, client, work = app(tmp_path)
    body = document()
    body["steps"]["prose"]["skills"] = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]
    response = client.put(
        f"/api/works/{work['id']}/agent-config",
        json={"requestId": CONFIG_REQUEST_ID, "expectedRevision": 0, "document": body},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "config-invalid"
    current = client.get(f"/api/works/{work['id']}/agent-config")
    assert current.json()["revision"] == 0
    store.close()
