from typing import Any

import pytest
from nextloop import ModelResponse, ProviderError
from test_generation_pipeline import QueueProvider, response
from work_fixtures import CAPTION, CREATIVE, OUTLINE, SEED, SETTING, WORK_ID

from agent4novel.agent.foundation_steps import OutlineStep, SettingStep
from agent4novel.agent.runtime import ModelRuntime
from agent4novel.domain.work import AgentConfig, CaptionContent, CreativeContent, OutlineContent
from agent4novel.errors import KnownError


def outline_without_ids() -> dict[str, Any]:
    return {
        "arcs": [
            {
                **{key: value for key, value in arc.items() if key not in {"arcId", "segments"}},
                "segments": [
                    {key: value for key, value in segment.items() if key != "segmentId"}
                    for segment in arc["segments"]
                ],
            }
            for arc in OUTLINE["arcs"]
        ]
    }


def setting_without_ids() -> dict[str, Any]:
    result = {}
    for key, value in SETTING.items():
        if key in {"world", "characters", "factions", "relationships"}:
            result[key] = [{field: item[field] for field in ("title", "content")} for item in value]
        elif key == "extensions":
            result[key] = [
                {
                    "title": section["title"],
                    "items": [
                        {field: item[field] for field in ("title", "content")}
                        for item in section["items"]
                    ],
                }
                for section in value
            ]
        else:
            result[key] = value
    return result


def runtime(provider: QueueProvider, parameters: list[dict[str, Any]]) -> ModelRuntime:
    def factory(**kwargs: Any) -> QueueProvider:
        parameters.append(kwargs["default_parameters"])
        return provider

    return ModelRuntime({"KIMI_API_KEY": "synthetic"}, provider_factory=factory)


async def test_outline_prompt_and_server_assigned_ids() -> None:
    parameters = []
    provider = QueueProvider([response(outline_without_ids())])
    step = OutlineStep(runtime(provider, parameters))

    result = await step.run(
        work_id=WORK_ID,
        seed=SEED,
        creative=CreativeContent.model_validate(CREATIVE),
        config=AgentConfig(),
    )

    assert result.arcs[0].arcId == f"{WORK_ID}-arc-1"
    assert result.arcs[0].segments[0].segmentId == f"{WORK_ID}-arc-1-seg-1"
    assert parameters[0]["max_tokens"] == 16000
    prompt = provider.requests[0].messages[1].content
    assert "选定创作方向(创意稿):" in prompt
    assert CREATIVE["directions"][0]["directionId"] in prompt
    assert "请产出全书大纲(弧线 + 剧情点两层结构)。" in prompt


async def test_setting_prompt_ids_and_no_retry() -> None:
    parameters = []
    provider = QueueProvider([response(setting_without_ids())])
    step = SettingStep(runtime(provider, parameters))

    result = await step.run(
        work_id=WORK_ID,
        seed=SEED,
        caption=CaptionContent.model_validate(CAPTION),
        creative=CreativeContent.model_validate(CREATIVE),
        outline=OutlineContent.model_validate(OUTLINE),
        config=AgentConfig(),
    )

    assert result.world[0].itemId.startswith("item-")
    assert parameters[0]["max_tokens"] == 16000
    prompt = provider.requests[0].messages[1].content
    assert "素材提炼稿:" in prompt
    assert "已通过大纲:" in prompt

    class FailingProvider:
        def __init__(self) -> None:
            self.attempts = 0

        async def complete(self, request: Any, *, attempt: int, cancel: Any) -> ModelResponse:
            self.attempts += 1
            raise ProviderError("temporary", retryable=True)

    failing = FailingProvider()
    step = SettingStep(
        ModelRuntime({"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: failing)
    )
    with pytest.raises(KnownError) as error:
        await step.run(
            work_id=WORK_ID,
            seed=SEED,
            caption=CaptionContent.model_validate(CAPTION),
            creative=CreativeContent.model_validate(CREATIVE),
            outline=OutlineContent.model_validate(OUTLINE),
            config=AgentConfig(),
        )
    assert error.value.code == "llm-unavailable"
    assert failing.attempts == 1


async def test_setting_rejects_model_supplied_ids() -> None:
    provider = QueueProvider([response(SETTING)])
    step = SettingStep(
        ModelRuntime({"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: provider)
    )
    with pytest.raises(KnownError) as error:
        await step.run(
            work_id=WORK_ID,
            seed=SEED,
            caption=CaptionContent.model_validate(CAPTION),
            creative=CreativeContent.model_validate(CREATIVE),
            outline=OutlineContent.model_validate(OUTLINE),
            config=AgentConfig(),
        )
    assert error.value.code == "llm-invalid-output"
