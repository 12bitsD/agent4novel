import json
from pathlib import Path
from typing import Any

from test_cli_run_step import invoke
from test_generation_pipeline import QueueProvider, response
from test_isolated_steps import record, runtime
from work_fixtures import CAPTION

import agent4novel.agent.recording as recording
from agent4novel.agent.isolated import StepExperimentRequest, run_isolated_step
from agent4novel.agent.recording import StepRecorder, StepRecordError, mark_step_record_unknown


def test_result_written_but_meta_failure_stays_partial(tmp_path: Path, monkeypatch: Any) -> None:
    directory = tmp_path / "record"
    directory.mkdir(mode=0o700)
    metadata = record(directory)
    request = StepExperimentRequest.model_validate(
        {"stepId": "caption", "input": {"seed": "合成素材"}, "record": metadata}
    )
    original = recording._replace

    def fail_complete_meta(path: Path, name: str, value: Any) -> None:
        if name == "meta.json" and value.get("status") == "complete":
            raise StepRecordError("record-write-failed:meta.json")
        original(path, name, value)

    monkeypatch.setattr(recording, "_replace", fail_complete_meta)
    provider = QueueProvider([response(CAPTION)])
    import asyncio

    result = asyncio.run(run_isolated_step(request, runtime(provider)))
    assert result["recording"]["status"] == "failed"
    meta = json.loads((directory / "meta.json").read_text())
    assert meta["complete"] is False and meta["status"] == "incomplete"
    result_file = json.loads((directory / "result.json").read_text())
    assert result_file["status"] == "succeeded"
    invocation_before = (directory / "invocation.json").read_bytes()
    assert json.loads(invocation_before)["captured"] is True
    monkeypatch.undo()
    assert request.record is not None
    mark_step_record_unknown(
        request.record, request.stepId, request.input, "unknown", "worker-failed"
    )
    assert (directory / "invocation.json").read_bytes() == invocation_before
    assert json.loads((directory / "result.json").read_text()) == result_file
    meta = json.loads((directory / "meta.json").read_text())
    assert meta["complete"] is False and meta["status"] == "incomplete"


def test_worker_failure_preserves_invocation_and_marks_unknown(
    tmp_path: Path, monkeypatch: Any
) -> None:
    seed = tmp_path / "seed.txt"
    seed.write_text("合成素材")
    directory = tmp_path / "record"
    provider = QueueProvider([])

    async def fail_worker(request: Any, model_runtime: Any, *, cancel_event: Any = None) -> Any:
        recorder = StepRecorder.start(
            request.record, request.input, "experiment-worker-failure", request.stepId, "kimi:test"
        )
        recorder.capture(
            {
                "system": "synthetic system",
                "prompt": "synthetic prompt",
                "model": "kimi:test",
                "attemptId": "attempt-synthetic",
                "effectiveConfig": None,
                "generation": None,
                "sdkOptions": None,
                "maxOutputTokens": 8000,
                "maxRetries": None,
                "requestTimeoutMs": 120000,
            }
        )
        raise RuntimeError("synthetic worker failure")

    monkeypatch.setattr("agent4novel.cli.run_isolated_step", fail_worker)
    code, error, _ = invoke(
        [
            "run-step",
            "caption",
            "--seed-file",
            str(seed),
            "--record-dir",
            str(directory),
        ],
        runtime(provider),
        tmp_path,
    )
    assert code == 1
    assert error["code"] == "step-worker-failed"
    assert "synthetic worker failure" not in str(error)
    invocation = json.loads((directory / "invocation.json").read_text())
    assert invocation["captured"] is True
    assert invocation["prompt"] == "synthetic prompt"
    result = json.loads((directory / "result.json").read_text())
    assert result["status"] == "unknown"
    assert result["content"] is None
    assert result["diagnostic"]["code"] == "worker-failed"
    meta = json.loads((directory / "meta.json").read_text())
    assert meta["complete"] is False and meta["status"] == "incomplete"
    assert provider.requests == []
