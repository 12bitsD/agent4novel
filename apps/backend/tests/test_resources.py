from pathlib import Path

from fastapi.testclient import TestClient
from resource_fixtures import (
    BAD_EXAMPLE_ID,
    EXTENSION_REQUEST_ID,
    SKILL_ID,
    SKILL_TEXT,
    WORK_ID,
    populate_resources,
)

from agent4novel.main import create_app


def test_author_config_and_immutable_file(tmp_path: Path) -> None:
    store, data_dir = populate_resources(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(data_dir)}, root=data_dir, store=store))
    response = client.get(f"/api/works/{WORK_ID}/agent-config")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["workId"] == WORK_ID
    assert body["revision"] == 1
    assert len(body["files"]) == 1
    assert len(body["effective"]) == 6
    assert body["effective"][0]["directionCount"] == 1
    assert body["effective"][0]["generation"] == {"temperature": 0.25, "topP": 0.8}
    assert body["effective"][0]["appliedPreferences"] == {}
    assert body["effective"][3]["appliedPreferences"] == {"genre": "都市"}
    assert body["effective"][5]["appliedPreferences"] == {
        "style": "简洁",
        "genre": "都市",
        "payoff": "成长",
    }
    assert body["effective"][5]["skills"][0]["id"] == SKILL_ID
    assert body["effective"][5]["tools"] == []

    file = client.get(f"/api/works/{WORK_ID}/agent-files/{SKILL_ID}")
    assert file.status_code == 200
    assert file.json()["file"]["id"] == SKILL_ID
    assert file.json()["text"] == SKILL_TEXT
    store.close()


def test_setting_extension_projection(tmp_path: Path) -> None:
    store, data_dir = populate_resources(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(data_dir)}, store=store))
    pending = client.get(f"/api/works/{WORK_ID}/setting-extensions/{EXTENSION_REQUEST_ID}")
    assert pending.status_code == 200
    body = pending.json()
    assert body["kind"] == "setting-extension"
    assert body["status"] == "pending"
    assert body["extension"]["sectionId"] == "section-1"
    assert body["impact"]["approvedChapterCount"] == 0
    assert body["impact"]["pendingChapterCount"] == 1
    assert body["impact"]["continuityWarning"] is False

    none = client.get(
        f"/api/works/{WORK_ID}/setting-extensions/55555555-5555-5555-8555-555555555555"
    )
    assert none.status_code == 200
    assert none.json()["status"] == "none"
    assert client.get(f"/api/works/{WORK_ID}/setting-extensions/not-a-uuid").status_code == 400
    store.close()


def test_bad_example_and_pagination(tmp_path: Path) -> None:
    store, data_dir = populate_resources(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(data_dir)}, store=store))
    record = client.get(f"/api/works/{WORK_ID}/bad-examples/{BAD_EXAMPLE_ID}")
    assert record.status_code == 200
    assert record.json()["id"] == BAD_EXAMPLE_ID
    assert record.json()["text"] == "第一章正文。"

    first = client.get(f"/api/works/{WORK_ID}/bad-examples?chapter=1")
    assert first.status_code == 200
    page = first.json()
    assert len(page["items"]) == 50
    assert page["nextCursor"] is not None
    second = client.get(f"/api/works/{WORK_ID}/bad-examples?chapter=1&after={page['nextCursor']}")
    assert second.status_code == 200
    assert len(second.json()["items"]) == 1
    assert "nextCursor" not in second.json()
    assert client.get(f"/api/works/{WORK_ID}/bad-examples?after=0").status_code == 400
    assert client.get(f"/api/works/{WORK_ID}/bad-examples/{BAD_EXAMPLE_ID[:-1]}").status_code == 404
    store.close()
