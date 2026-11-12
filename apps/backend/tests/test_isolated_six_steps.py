import json
from pathlib import Path

import pytest
from test_generation_pipeline import QueueProvider, response
from test_isolated_steps import record
from work_fixtures import BEAT, CAPTION, CREATIVE, OUTLINE, PROSE, SETTING

from agent4novel.agent.isolated import run_isolated_step
from agent4novel.agent.runtime import ModelRuntime


def runtime(provider: QueueProvider) -> ModelRuntime:
    return ModelRuntime({"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: provider)


def without_ids(value: dict, *ids: str) -> dict:
    return {key: item for key, item in value.items() if key not in ids}


def setting_draft() -> dict:
    return {
        **SETTING,
        **{
            section: [without_ids(item, "itemId") for item in SETTING[section]]
            for section in ("world", "characters", "factions", "relationships")
        },
        "extensions": [
            {
                **without_ids(section, "sectionId"),
                "items": [without_ids(item, "itemId") for item in section["items"]],
            }
            for section in SETTING["extensions"]
        ],
    }


@pytest.mark.parametrize("step", ["outline", "setting", "beat", "prose"])
async def test_all_remaining_production_steps_run_independently(step: str) -> None:
    selected = {"directions": CREATIVE["directions"][:1]}
    outline_draft = {
        "arcs": [
            {
                **without_ids(arc, "arcId"),
                "segments": [without_ids(segment, "segmentId") for segment in arc["segments"]],
            }
            for arc in OUTLINE["arcs"]
        ]
    }
    beat_draft = {
        **BEAT,
        "writingPlan": [without_ids(item, "itemId") for item in BEAT["writingPlan"]],
    }
    cases = {
        "outline": (
            {"seed": "合成素材", "upstream": {"creative": selected}},
            outline_draft,
        ),
        "setting": (
            {
                "seed": "合成素材",
                "upstream": {"caption": CAPTION, "creative": selected, "outline": OUTLINE},
            },
            setting_draft(),
        ),
        "beat": (
            {
                "seed": "合成素材",
                "chapter": 2,
                "upstream": {
                    "outline": OUTLINE,
                    "setting": SETTING,
                    "previousChapter": {"chapter": 1, "beat": BEAT, "prose": PROSE},
                },
            },
            beat_draft,
        ),
        "prose": (
            {
                "seed": "合成素材",
                "chapter": 2,
                "upstream": {
                    "beat": BEAT,
                    "setting": SETTING,
                    "previousChapter": {"chapter": 1, "beat": BEAT, "prose": PROSE},
                },
            },
            {"text": "第二章完整正文"},
        ),
    }
    input_value, output = cases[step]
    provider = QueueProvider([response(output)])
    result = await run_isolated_step({"stepId": step, "input": input_value}, runtime(provider))
    assert result["kind"] == "succeeded", result
    assert result["stepId"] == step
    assert len(provider.requests) == 1
    if step == "outline":
        assert result["content"]["arcs"][0]["arcId"] == f"{result['runId']}-arc-1"
    if step == "setting":
        assert result["content"]["world"][0]["itemId"] != "world-1"
    if step == "beat":
        assert result["content"]["writingPlan"][0]["itemId"].startswith("beat-item-")
    if step == "prose":
        assert result["content"] == output


@pytest.mark.parametrize(
    ("step", "input_value"),
    [
        (
            "outline",
            {
                "seed": "素材",
                "upstream": {"creative": {**CREATIVE, "directions": CREATIVE["directions"] * 2}},
            },
        ),
        (
            "beat",
            {"seed": "素材", "chapter": 2, "upstream": {"outline": OUTLINE, "setting": SETTING}},
        ),
        (
            "beat",
            {
                "seed": "素材",
                "chapter": 1,
                "upstream": {
                    "outline": OUTLINE,
                    "setting": SETTING,
                    "previousChapter": {"chapter": 1, "beat": BEAT, "prose": PROSE},
                },
            },
        ),
        (
            "prose",
            {
                "seed": "素材",
                "chapter": 1,
                "upstream": {"beat": BEAT, "setting": SETTING},
                "regeneration": {"content": BEAT, "instructions": "重写"},
            },
        ),
    ],
)
async def test_step_guards_prevent_invalid_or_ambiguous_calls(step: str, input_value: dict) -> None:
    provider = QueueProvider([])
    result = await run_isolated_step({"stepId": step, "input": input_value}, runtime(provider))
    assert result["kind"] == "failed"
    assert result["code"] in {"invalid-input", "direction-not-selected"}
    assert provider.requests == []


async def test_chapter_recording_contains_actual_previous_chapter_and_no_retries(
    tmp_path: Path,
) -> None:
    directory = tmp_path / "record"
    directory.mkdir(mode=0o700)
    provider = QueueProvider(
        [
            response(
                {
                    **BEAT,
                    "writingPlan": [without_ids(item, "itemId") for item in BEAT["writingPlan"]],
                }
            )
        ]
    )
    result = await run_isolated_step(
        {
            "stepId": "beat",
            "input": {
                "seed": "合成素材",
                "chapter": 2,
                "upstream": {
                    "outline": OUTLINE,
                    "setting": SETTING,
                    "previousChapter": {"chapter": 1, "beat": BEAT, "prose": PROSE},
                },
            },
            "record": record(directory),
        },
        runtime(provider),
    )
    assert result["kind"] == "succeeded"
    invocation = json.loads((directory / "invocation.json").read_text())
    assert invocation["captured"] is True
    assert invocation["maxRetries"] == 0
    assert "第一章正文" in invocation["prompt"]
    assert json.loads((directory / "input.json").read_text())["input"]["chapter"] == 2
    meta = json.loads((directory / "meta.json").read_text())
    assert meta["complete"] is True and meta["status"] == "complete"
