import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
from work_fixtures import WORK_ID, populate

from agent4novel.main import create_app


def test_work_read_routes_match_public_view(tmp_path: Path) -> None:
    path = tmp_path / "agent4novel.sqlite"
    store = populate(path)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    client = TestClient(create_app({}, store=store))

    listed = client.get("/api/works")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == WORK_ID

    response = client.get(f"/api/works/{WORK_ID}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == WORK_ID
    assert body["currentChapter"] == 1
    assert body["workflowState"] == "awaiting-selection"
    assert body["nextStepId"] is None
    assert body["allowedActions"] == ["save-draft", "select", "generate"]
    assert body["chapters"] == [
        {
            "chapter": 1,
            "title": "第一章",
            "beatStatus": "approved",
            "proseStatus": "pending",
            "allowedActions": ["save-draft", "approve", "regenerate"],
            "needsContinuityReview": False,
        }
    ]
    assert [artifact["id"] for artifact in body["artifacts"]] == [
        "caption-1",
        "creative-2",
        "outline-1",
        "setting-1",
        "beat-1",
        "prose-1",
    ]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before

    history = client.get(
        f"/api/works/{WORK_ID}/artifacts/creative/versions/1?artifactId=creative-1"
    )
    assert history.status_code == 404
    beat_history = client.get(f"/api/works/{WORK_ID}/artifacts/beat/1/versions/1?artifactId=beat-1")
    assert beat_history.status_code == 200
    assert beat_history.json()["id"] == "beat-1"
    assert (
        client.get(
            f"/api/works/{WORK_ID}/artifacts/beat/1/versions/2?artifactId=beat-1"
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/works/{WORK_ID}/artifacts/caption/1/versions/1?artifactId=caption-1"
        ).status_code
        == 400
    )
    assert client.get("/api/works/missing").status_code == 404
    store.close()
