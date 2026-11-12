import asyncio
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_beat_pipeline import ready_for_beat
from test_first_chapter_pipeline import approve_current_beat

from agent4novel.agent.fake_steps import fake_beat
from agent4novel.agent.runtime import ModelRuntime
from agent4novel.domain.requests import ProseSaveRequest
from agent4novel.main import create_app
from agent4novel.pipeline_generation import GenerationPipeline
from agent4novel.services.command_runtime import CommandScope
from agent4novel.store.work import SqliteStore


def approve_prose_chapter(client: TestClient, store: SqliteStore, work: dict, chapter: int) -> None:
    advanced = client.post(f"/api/works/{work['id']}/advance")
    assert advanced.status_code == 200, advanced.text
    assert advanced.json()["stepId"] == "prose"
    prose = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "prose" and item.chapter == chapter
    )
    approved = client.post(
        f"/api/works/{work['id']}/artifacts/prose/approve",
        json={
            "chapter": chapter,
            "expectedArtifactId": prose.id,
            "expectedHeadVersion": prose.version,
            "content": prose.content.model_dump(),
        },
    )
    assert approved.status_code == 200, approved.text


def approve_beat_chapter(client: TestClient, store: SqliteStore, work: dict, chapter: int) -> None:
    beat = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "beat" and item.chapter == chapter
    )
    response = client.post(
        f"/api/works/{work['id']}/artifacts/beat/approve",
        json={
            "chapter": chapter,
            "expectedArtifactId": beat.id,
            "expectedHeadVersion": beat.version,
            "content": beat.content.model_dump(),
        },
    )
    assert response.status_code == 200, response.text


def first_chapter(client: TestClient, store: SqliteStore, tmp_path: Path) -> dict:
    work = ready_for_beat(client, store, tmp_path)
    approve_current_beat(client, store, work)
    approve_prose_chapter(client, store, work, 1)
    return work


def start_request(store: SqliteStore, work: dict, chapter: int) -> dict[str, Any]:
    previous = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "prose" and item.chapter == chapter - 1
    )
    return {
        "chapter": chapter,
        "expectedPreviousProseId": previous.id,
        "expectedPreviousProseVersion": previous.version,
    }


def test_explicit_chapter_start_and_approved_pair(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = first_chapter(client, store, tmp_path)
    request = start_request(store, work, 2)
    started = client.post(f"/api/works/{work['id']}/chapters/start", json=request)
    assert started.status_code == 200, started.text
    outcome = started.json()
    assert outcome["kind"] == "advanced"
    assert outcome["state"]["pendingGate"] == {"kind": "beat", "chapter": 2}
    assert outcome["beatCommand"]["target"]["chapter"] == 2
    beat = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "beat" and item.chapter == 2
    )
    previous_prose = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "prose" and item.chapter == 1
    )
    previous_beat = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "beat" and item.chapter == 1
    )
    assert [(ref.kind, ref.chapter, ref.artifactId) for ref in beat.inputs] == [
        ("outline", None, beat.inputs[0].artifactId),
        ("setting", None, beat.inputs[1].artifactId),
        ("beat", 1, previous_beat.id),
        ("prose", 1, previous_prose.id),
    ]

    replay = client.post(f"/api/works/{work['id']}/chapters/start", json=request)
    assert replay.status_code == 200
    assert replay.json()["kind"] == "awaiting-approval"
    assert (
        len(
            [
                item
                for item in store.get_work(work["id"]).artifacts
                if item.kind == "beat" and item.chapter == 2
            ]
        )
        == 1
    )
    approve_beat_chapter(client, store, work, 2)
    approve_prose_chapter(client, store, work, 2)
    completed = client.post(f"/api/works/{work['id']}/chapters/start", json=request)
    assert completed.json()["kind"] == "complete"
    assert not any(
        item.kind == "beat" and item.chapter == 3 for item in store.get_work(work["id"]).artifacts
    )
    view = client.get(f"/api/works/{work['id']}").json()
    assert view["currentChapter"] == 2
    assert [chapter["proseStatus"] for chapter in view["chapters"]] == ["approved", "approved"]
    assert "start-next-chapter" in view["chapters"][1]["allowedActions"]
    store.close()


def test_two_phase_chapter_regeneration_and_continuity(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = first_chapter(client, store, tmp_path)
    client.post(f"/api/works/{work['id']}/chapters/start", json=start_request(store, work, 2))
    approve_beat_chapter(client, store, work, 2)
    approve_prose_chapter(client, store, work, 2)
    old_beat = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "beat" and item.chapter == 1
    )
    old_prose = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "prose" and item.chapter == 1
    )
    second_prose = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "prose" and item.chapter == 2
    )
    binding = {
        "mode": "chapter-regeneration",
        "expectedBeat": {"artifactId": old_beat.id, "version": old_beat.version},
        "expectedProse": {"artifactId": old_prose.id, "version": old_prose.version},
    }

    edited = client.post(
        f"/api/works/{work['id']}/artifacts/prose/save",
        json={
            "chapter": 1,
            "expectedArtifactId": old_prose.id,
            "expectedHeadVersion": old_prose.version,
            "expectedHumanStatus": "approved",
            "content": {"text": "第一章修改后的事实"},
        },
    )
    assert edited.status_code == 200, edited.text
    current_prose = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "prose" and item.chapter == 1
    )
    binding["expectedProse"] = {"artifactId": current_prose.id, "version": current_prose.version}
    regenerated_beat = client.post(
        f"/api/works/{work['id']}/artifacts/beat/regenerate",
        json={
            "chapter": 1,
            "expectedArtifactId": old_beat.id,
            "expectedHeadVersion": old_beat.version,
            "content": old_beat.content.model_dump(),
            "instructions": "重新规划历史章",
            "regeneration": binding,
        },
    )
    assert regenerated_beat.status_code == 200, regenerated_beat.text
    pending_beat = regenerated_beat.json()["artifact"]
    assert pending_beat["version"] == old_beat.version + 1
    assert pending_beat["humanStatus"] == "pending"
    assert (
        next(
            item
            for item in store.get_work(work["id"]).artifacts
            if item.kind == "prose" and item.chapter == 2
        ).content.text
        == second_prose.content.text
    )
    view = client.get(f"/api/works/{work['id']}").json()
    assert view["chapters"][0]["needsContinuityReview"] is True
    assert view["chapters"][1]["needsContinuityReview"] is True
    assert "start-next-chapter" not in view["chapters"][0]["allowedActions"]

    approve_beat_chapter(client, store, work, 1)
    binding["expectedBeat"] = {"artifactId": pending_beat["id"], "version": pending_beat["version"]}
    regenerated_prose = client.post(
        f"/api/works/{work['id']}/artifacts/prose/regenerate",
        json={
            "chapter": 1,
            "expectedArtifactId": binding["expectedProse"]["artifactId"],
            "expectedHeadVersion": binding["expectedProse"]["version"],
            "content": current_prose.content.model_dump(),
            "instructions": "按新章纲重写",
            "regeneration": binding,
        },
    )
    assert regenerated_prose.status_code == 200, regenerated_prose.text
    pending_prose = regenerated_prose.json()["artifact"]
    assert pending_prose["humanStatus"] == "pending"
    assert pending_prose["version"] == binding["expectedProse"]["version"] + 1
    approved = client.post(
        f"/api/works/{work['id']}/artifacts/prose/approve",
        json={
            "chapter": 1,
            "expectedArtifactId": pending_prose["id"],
            "expectedHeadVersion": pending_prose["version"],
            "content": pending_prose["content"],
        },
    )
    assert approved.status_code == 200, approved.text
    view = client.get(f"/api/works/{work['id']}").json()
    assert "start-next-chapter" in view["chapters"][1]["allowedActions"]
    history = client.get(
        f"/api/works/{work['id']}/artifacts/prose/1/versions/{old_prose.version}?artifactId={old_prose.id}"
    )
    assert history.status_code == 200
    assert history.json()["id"] == old_prose.id
    store.close()


async def test_start_chapter_lock_and_stale_previous_input(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = first_chapter(client, store, tmp_path)
    pipeline = GenerationPipeline(store, runtime=ModelRuntime({"KIMI_API_KEY": "synthetic"}))
    entered = asyncio.Event()
    release = asyncio.Event()

    class BlockingBeat:
        async def run(self, **kwargs: Any) -> Any:
            entered.set()
            await release.wait()
            return fake_beat(kwargs["chapter"], kwargs["outline"], kwargs["setting"])

    pipeline.beat_step = BlockingBeat()
    request = start_request(store, work, 2)
    running = asyncio.create_task(pipeline.start_chapter(work["id"], request))
    await entered.wait()
    with pytest.raises(Exception) as locked:
        await pipeline.start_chapter(work["id"], request)
    assert getattr(locked.value, "code", None) == "advance-in-progress"
    with pytest.raises(Exception) as advancing:
        await pipeline.advance(work["id"])
    assert getattr(advancing.value, "code", None) == "advance-in-progress"

    previous = next(
        item
        for item in store.get_work(work["id"]).artifacts
        if item.kind == "prose" and item.chapter == 1
    )
    changed = await pipeline.save_prose(
        work["id"],
        ProseSaveRequest(
            chapter=1,
            expectedArtifactId=previous.id,
            expectedHeadVersion=previous.version,
            expectedHumanStatus="approved",
            content={"text": "生成期间修改的第一章"},
        ),
        CommandScope.create(pipeline.runtime),
    )
    assert changed[0].version == previous.version + 1
    release.set()
    result = await running
    assert result["kind"] == "failed"
    assert result["code"] == "upstream-changed"
    assert result["beatCommand"].writeOutcome == "not-committed"
    assert not any(
        item.kind == "beat" and item.chapter == 2 for item in store.get_work(work["id"]).artifacts
    )
    store.close()
