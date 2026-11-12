import json
from typing import Any

import httpx
import pytest
from nextloop import FinishReason, ModelResponse, ModelUsage, OpenAIProvider, ProviderError
from work_fixtures import CAPTION, CREATIVE, SEED, WORK_ID

from agent4novel.agent.runtime import ModelRuntime
from agent4novel.agent.steps import CaptionStep, CreativeStep, truncate_seed, utf16_length
from agent4novel.config import ModelConfigError
from agent4novel.domain.work import AgentConfig, CaptionContent
from agent4novel.errors import KnownError


class ScriptedProvider:
    def __init__(self, content: str, finish_reason: FinishReason = FinishReason.STOP) -> None:
        self.content = content
        self.finish_reason = finish_reason
        self.requests: list[Any] = []

    async def complete(self, request: Any, *, attempt: int, cancel: Any) -> ModelResponse:
        self.requests.append(request)
        return ModelResponse(
            content=self.content,
            finish_reason=self.finish_reason,
            usage=ModelUsage(input_tokens=10, output_tokens=4),
        )


def runtime(provider: Any, **env: str) -> ModelRuntime:
    return ModelRuntime(
        {"KIMI_API_KEY": "synthetic", **env},
        provider_factory=lambda **kwargs: provider,
    )


def pack() -> dict[str, Any]:
    direction = CREATIVE["directions"][0]
    return {key: value for key, value in direction.items() if key != "directionId"}


async def test_caption_runs_agent_loop_and_trims_contract() -> None:
    content = {
        "inputStage": "脑洞",
        "summary": "  有内容的发展判断  ",
        "elements": [{"kind": "  人物 ", "content": " 主角采取行动 "}],
        "gaps": [" 作者可以选择调查或逃离 "],
    }
    provider = ScriptedProvider(json.dumps(content, ensure_ascii=False))
    step = CaptionStep(runtime(provider))

    result = await step.run(work_id=WORK_ID, seed=SEED, config=AgentConfig())

    assert result.summary == "有内容的发展判断"
    assert result.elements[0].kind == "人物"
    assert result.gaps == ["作者可以选择调查或逃离"]
    assert len(provider.requests) == 1
    candidate = provider.requests[0]
    assert candidate.messages[0].role == "system"
    assert "你是故事开发编辑" in candidate.messages[0].content
    assert candidate.messages[1].content == f"作者原始素材:\n{SEED}\n\n请输出提炼稿。"
    assert candidate.tools == ()
    telemetry = step.runtime.telemetry.telemetry_for(WORK_ID)
    assert len(telemetry) == 1
    assert telemetry[0].ok is True
    assert telemetry[0].inputTokens == 10
    assert telemetry[0].outputTokens == 4


async def test_creative_injects_ids_and_honors_direction_count() -> None:
    provider = ScriptedProvider(json.dumps({"directions": [pack(), pack()]}, ensure_ascii=False))
    step = CreativeStep(runtime(provider))

    result = await step.run(
        work_id=WORK_ID,
        seed=SEED,
        caption=CaptionContent.model_validate(CAPTION),
        config=AgentConfig(directionCount=2),
    )

    assert [direction.directionId for direction in result.directions] == [
        f"{WORK_ID}-dir-1",
        f"{WORK_ID}-dir-2",
    ]
    prompt = provider.requests[0].messages[1].content
    assert "请产出 2 个差异化的创作方向(创意稿)。" in prompt
    assert "directionId" not in json.loads(
        provider.requests[0]
        .messages[1]
        .content.split("素材提炼稿:\n", 1)[1]
        .split("\n\n请产出", 1)[0]
    )


async def test_creative_rejects_wrong_direction_count() -> None:
    provider = ScriptedProvider(json.dumps({"directions": [pack()]}, ensure_ascii=False))
    step = CreativeStep(runtime(provider))

    with pytest.raises(KnownError) as error:
        await step.run(
            work_id=WORK_ID,
            seed=SEED,
            caption=CaptionContent.model_validate(CAPTION),
            config=AgentConfig(directionCount=2),
        )
    assert error.value.code == "llm-invalid-output"
    assert error.value.retryable is True


async def test_provider_failure_does_not_expose_response_text() -> None:
    class FailingProvider:
        async def complete(self, request: Any, *, attempt: int, cancel: Any) -> ModelResponse:
            raise ProviderError("PRIVATE_PROVIDER_TEXT", retryable=False)

    step = CaptionStep(runtime(FailingProvider()))
    with pytest.raises(KnownError) as error:
        await step.run(work_id=WORK_ID, seed=SEED, config=AgentConfig())
    assert error.value.code == "llm-unavailable"
    assert "PRIVATE_PROVIDER_TEXT" not in str(error.value)
    telemetry = step.runtime.telemetry.telemetry_for(WORK_ID)
    assert telemetry[0].ok is False
    assert telemetry[0].error == "network"


async def test_openai_provider_sse_transport_uses_json_mode() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        content = json.dumps(CAPTION, ensure_ascii=False)
        chunks = [
            {"choices": [{"delta": {"content": content}, "finish_reason": None}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 8, "completion_tokens": 3}},
        ]
        body = "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks)
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, text=body + "data: [DONE]\n\n"
        )

    def factory(**kwargs: Any) -> OpenAIProvider:
        return OpenAIProvider(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        )

    step = CaptionStep(ModelRuntime({"KIMI_API_KEY": "synthetic"}, provider_factory=factory))
    result = await step.run(work_id=WORK_ID, seed=SEED, config=AgentConfig())

    assert result.summary == CAPTION["summary"]
    assert len(seen) == 1
    assert str(seen[0].url) == "https://api.moonshot.cn/v1/chat/completions"
    payload = json.loads(seen[0].content)
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["max_tokens"] == 8000
    assert payload["messages"][1] == {
        "role": "user",
        "content": f"作者原始素材:\n{SEED}\n\n请输出提炼稿。",
    }


def test_model_defaults_longcat_and_seed_budget() -> None:
    model = ModelRuntime({"LONGCAT_API_KEY": "synthetic"})
    assert model.default_model_id == "longcat:LongCat-2.0"
    assert model.generation_settings(AgentConfig()).parameters == {
        "thinking": "disabled",
        "temperature": 0.9,
        "topP": 0.95,
    }
    assert model.provider_config().base_url == "https://api.longcat.chat/openai/v1"
    truncated = truncate_seed("😀" * 50_001)
    assert utf16_length(truncated) == 100_000
    assert truncated == "😀" * 50_000


@pytest.mark.parametrize(
    "env",
    [
        {"KIMI_BASE_URL": "http://example.com"},
        {"KIMI_BASE_URL": "https://user:password@example.com"},
        {"KIMI_BASE_URL": "https://example.com?private=true"},
        {"A4N_LLM_TIMEOUT_MS": "999"},
        {"A4N_LLM_TIMEOUT_MS": "1.5"},
    ],
)
def test_invalid_runtime_configuration_fails_closed(env: dict[str, str]) -> None:
    with pytest.raises(ModelConfigError):
        ModelRuntime({"KIMI_API_KEY": "synthetic", **env})


async def test_generation_options_are_mapped_to_openai_top_p() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        content = json.dumps(CAPTION, ensure_ascii=False)
        chunks = [
            {"choices": [{"delta": {"content": content}, "finish_reason": None}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 8, "completion_tokens": 3}},
        ]
        body = (
            "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks)
            + "data: [DONE]\n\n"
        )
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)

    def factory(**kwargs: Any) -> OpenAIProvider:
        return OpenAIProvider(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        )

    step = CaptionStep(ModelRuntime({"KIMI_API_KEY": "synthetic"}, provider_factory=factory))
    await step.run(
        work_id=WORK_ID,
        seed=SEED,
        config=AgentConfig(temperature=0.25, topP=0.8),
    )
    payload = json.loads(seen[0].content)
    assert payload["top_p"] == 0.8
    assert "topP" not in payload


async def test_default_provider_attempt_budget_is_three() -> None:
    class FailingProvider:
        def __init__(self) -> None:
            self.attempts = 0

        async def complete(self, request: Any, *, attempt: int, cancel: Any) -> ModelResponse:
            self.attempts += 1
            raise ProviderError("synthetic transient failure", retryable=True)

    provider = FailingProvider()
    step = CaptionStep(runtime(provider))
    with pytest.raises(KnownError):
        await step.run(work_id=WORK_ID, seed=SEED, config=AgentConfig())
    assert provider.attempts == 3
