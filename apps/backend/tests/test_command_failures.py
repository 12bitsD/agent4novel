from pathlib import Path

from fastapi.testclient import TestClient
from test_beat_pipeline import ready_for_beat
from test_first_chapter_pipeline import approve_current_beat

from agent4novel.domain.requests import ProseApproveRequest
from agent4novel.domain.work import ProseContent
from agent4novel.main import create_app
from agent4novel.pipeline_generation import GenerationPipeline
from agent4novel.services.command_runtime import CommandScope, prose_response_error
from agent4novel.store.work import SqliteStore


async def test_response_failure_marks_unknown_without_erasing_commit(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = ready_for_beat(client, store, tmp_path)
    approve_current_beat(client, store, work)
    client.post(f"/api/works/{work['id']}/advance")
    baseline = store.get_work(work["id"]).artifacts[-1]
    pipeline = GenerationPipeline(store)
    scope = CommandScope.create(pipeline.runtime)
    artifact, committed = await pipeline.approve_prose(
        work["id"],
        ProseApproveRequest(
            chapter=1,
            expectedArtifactId=baseline.id,
            expectedHeadVersion=baseline.version,
            content=ProseContent(text=baseline.content.text),
        ),
        scope,
    )

    failure = prose_response_error(
        work["id"],
        committed,
        RuntimeError("synthetic response failure"),
        buffer=pipeline.telemetry,
        scope=scope,
    )

    assert failure.command.writeOutcome == "unknown"
    assert failure.command.failureStage == "response"
    assert failure.command.resultHead is None
    assert store.get_work(work["id"]).artifacts[-1].humanStatus == "approved"
    assert store.get_work(work["id"]).artifacts[-1].id == artifact.id
    commands = pipeline.telemetry.diagnostics_for(work["id"]).commands
    assert commands[-1].code == "internal-error"
    assert commands[-1].command["writeOutcome"] == "unknown"
    store.close()
