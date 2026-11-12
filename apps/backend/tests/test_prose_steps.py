from typing import Any

import pytest
from nextloop import ModelResponse, ProviderError
from test_generation_pipeline import QueueProvider, response
from work_fixtures import BEAT, SEED, SETTING, WORK_ID

from agent4novel.agent.prose_steps import ProseRegeneration, ProseStep
from agent4novel.agent.runtime import ModelRuntime
from agent4novel.domain.work import AgentConfig, BeatContent, SettingContent
from agent4novel.errors import KnownError


def runtime(provider: Any, parameters: list[dict[str, Any]]) -> ModelRuntime:
    def factory(**kwargs: Any) -> Any:
        parameters.append(kwargs["default_parameters"])
        return provider

    return ModelRuntime({"KIMI_API_KEY": "synthetic"}, provider_factory=factory)


async def test_prose_prompt_and_output_budget() -> None:
    parameters = []
    provider = QueueProvider([response({"text": "第一章完整正文。"})])
    step = ProseStep(runtime(provider, parameters))

    result = await step.run(
        work_id=WORK_ID,
        seed=SEED,
        chapter=1,
        beat=BeatContent.model_validate(BEAT),
        setting=SettingContent.model_validate(SETTING),
        config=AgentConfig(),
    )

    assert result.text == "第一章完整正文。"
    assert parameters[0]["max_tokens"] == 16000
    prompt = provider.requests[0].messages[1].content
    assert "完整已通过章纲：" in prompt
    assert "完整已通过设定：" in prompt
    assert "不提前续写第 2 章" in prompt


async def test_prose_regeneration_and_no_provider_retry() -> None:
    provider = QueueProvider([response({"text": "重写后的完整正文。"})])
    step = ProseStep(runtime(provider, []))

    result = await step.run(
        work_id=WORK_ID,
        seed=SEED,
        chapter=1,
        beat=BeatContent.model_validate(BEAT),
        setting=SettingContent.model_validate(SETTING),
        config=AgentConfig(),
        regeneration=ProseRegeneration(
            content={"text": "旧正文"},
            instructions="保留结局但加强动作",
        ),
    )

    assert result.text == "重写后的完整正文。"
    prompt = provider.requests[0].messages[1].content
    assert "旧正文" in prompt
    assert "保留结局但加强动作" in prompt

    class FailingProvider:
        def __init__(self) -> None:
            self.attempts = 0

        async def complete(self, request: Any, *, attempt: int, cancel: Any) -> ModelResponse:
            self.attempts += 1
            raise ProviderError("temporary", retryable=True)

    failing = FailingProvider()
    step = ProseStep(
        ModelRuntime({"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: failing)
    )
    with pytest.raises(KnownError) as error:
        await step.run(
            work_id=WORK_ID,
            seed=SEED,
            chapter=1,
            beat=BeatContent.model_validate(BEAT),
            setting=SettingContent.model_validate(SETTING),
            config=AgentConfig(),
        )
    assert error.value.code == "llm-unavailable"
    assert failing.attempts == 1


async def test_prose_input_budget_is_checked_before_model_call() -> None:
    provider = QueueProvider([])
    step = ProseStep(runtime(provider, []), system_prompt="x" * 400_001)

    with pytest.raises(KnownError) as error:
        await step.run(
            work_id=WORK_ID,
            seed=SEED,
            chapter=1,
            beat=BeatContent.model_validate(BEAT),
            setting=SettingContent.model_validate(SETTING),
            config=AgentConfig(),
        )

    assert error.value.code == "input-budget-exceeded"
    assert error.value.inputBudget["limit"] == 400_000
    assert provider.requests == []


async def test_prose_rejects_empty_model_text() -> None:
    provider = QueueProvider([response({"text": "  "})])
    step = ProseStep(runtime(provider, []))
    with pytest.raises(KnownError) as error:
        await step.run(
            work_id=WORK_ID,
            seed=SEED,
            chapter=1,
            beat=BeatContent.model_validate(BEAT),
            setting=SettingContent.model_validate(SETTING),
            config=AgentConfig(),
        )
    assert error.value.code == "llm-invalid-output"
