import json
import stat
from pathlib import Path

import pytest
from test_generation_pipeline import QueueProvider, creative_content, response
from work_fixtures import CAPTION, CREATIVE

from agent4novel.agent.isolated import run_isolated_step
from agent4novel.agent.recording import StepRecordError, reserve_step_record_dir
from agent4novel.agent.runtime import ModelRuntime


def record(directory: Path) -> dict[str, object]:
    return {
        "dir": str(directory),
        "sources": {
            "input": "seed-file",
            "inputPath": "/private/seed.txt",
            "systemPromptPath": None,
            "configPath": None,
        },
        "version": {"gitCommit": None, "gitDirty": None},
    }


def runtime(provider: QueueProvider) -> ModelRuntime:
    return ModelRuntime({"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: provider)


def read(directory: Path, name: str) -> dict:
    return json.loads((directory / name).read_text())


async def test_records_actual_caption_invocation_and_result(tmp_path: Path) -> None:
    directory = tmp_path / "record"
    directory.mkdir(mode=0o700)
    provider = QueueProvider([response(CAPTION)])
    result = await run_isolated_step(
        {
            "stepId": "caption",
            "input": {"seed": "recorded seed"},
            "systemPrompt": "recorded system",
            "config": {"temperature": 0.4, "topP": 0.6},
            "record": record(directory),
        },
        runtime(provider),
    )

    assert result["kind"] == "succeeded"
    assert result["recording"]["status"] == "complete"
    assert sorted(path.name for path in directory.iterdir()) == [
        "input.json",
        "invocation.json",
        "meta.json",
        "result.json",
    ]
    invocation = read(directory, "invocation.json")
    assert invocation["captured"] is True
    assert invocation["system"] == "recorded system"
    assert invocation["prompt"] == "作者原始素材:\nrecorded seed\n\n请输出提炼稿。"
    assert invocation["effectiveConfig"] == {
        "model": "kimi:kimi-k2.8-highspeed",
        "directionCount": None,
        "thinking": None,
        "temperature": 0.4,
        "topP": 0.6,
    }
    assert invocation["sdkOptions"] == {"temperature": 0.4, "topP": 0.6, "providerOptions": None}
    assert invocation["maxOutputTokens"] == 8000
    assert invocation["maxRetries"] is None
    assert invocation["requestTimeoutMs"] == 120000
    assert read(directory, "result.json")["status"] == "succeeded"
    assert read(directory, "result.json")["content"] == CAPTION
    assert read(directory, "meta.json")["complete"] is True
    assert read(directory, "meta.json")["status"] == "complete"
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    for name in ["input.json", "invocation.json", "result.json", "meta.json"]:
        assert stat.S_IMODE((directory / name).stat().st_mode) == 0o600


async def test_validation_failure_does_not_fabricate_invocation(tmp_path: Path) -> None:
    directory = tmp_path / "record"
    directory.mkdir(mode=0o700)
    provider = QueueProvider([])
    result = await run_isolated_step(
        {
            "stepId": "creative",
            "input": {"seed": "missing caption"},
            "record": record(directory),
        },
        runtime(provider),
    )

    assert result["kind"] == "failed"
    assert result["code"] == "invalid-input"
    assert result["recording"]["status"] == "complete"
    assert provider.requests == []
    assert read(directory, "invocation.json")["captured"] is False
    assert read(directory, "result.json")["diagnostic"]["code"] == "invalid-input"
    assert read(directory, "meta.json")["complete"] is True


async def test_record_collision_preserves_original_and_skips_model(tmp_path: Path) -> None:
    directory = tmp_path / "record"
    directory.mkdir(mode=0o700)
    original = b'{"original":true}\n'
    (directory / "input.json").write_bytes(original)
    provider = QueueProvider([response(CAPTION)])
    result = await run_isolated_step(
        {"stepId": "caption", "input": {"seed": "not run"}, "record": record(directory)},
        runtime(provider),
    )

    assert result["kind"] == "failed"
    assert result["code"] == "recording-failed"
    assert result["recording"]["status"] == "failed"
    assert provider.requests == []
    assert (directory / "input.json").read_bytes() == original


async def test_isolated_creative_uses_regeneration_and_run_id(tmp_path: Path) -> None:
    direction = CREATIVE["directions"][0]
    provider = QueueProvider([response({"directions": creative_content()["directions"][:1]})])
    result = await run_isolated_step(
        {
            "stepId": "creative",
            "input": {
                "seed": "合成素材",
                "upstream": {"caption": CAPTION},
                "regeneration": {"content": CREATIVE, "instructions": "加快冲突推进"},
            },
            "config": {"directionCount": 1},
        },
        runtime(provider),
    )

    assert result["kind"] == "succeeded"
    assert result["content"]["directions"][0]["directionId"] == f"{result['runId']}-dir-1"
    assert "加快冲突推进" in provider.requests[0].messages[1].content
    assert result["content"]["directions"][0]["directionId"] != direction["directionId"]


async def test_isolated_step_never_uses_demo_output() -> None:
    provider = QueueProvider([])
    result = await run_isolated_step(
        {"stepId": "caption", "input": {"seed": "合成素材"}},
        ModelRuntime({}, provider_factory=lambda **kwargs: provider),
    )
    assert result["kind"] == "failed"
    assert result["code"] == "llm-unavailable"
    assert provider.requests == []


def test_record_path_rejects_symlink_parents(tmp_path: Path) -> None:
    actual = tmp_path / "actual"
    actual.mkdir()
    link = tmp_path / "link"
    link.symlink_to(actual, target_is_directory=True)
    with pytest.raises(StepRecordError):
        reserve_step_record_dir(str(link / "record"))
    assert not (actual / "record").exists()
