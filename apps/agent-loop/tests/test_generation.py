from typing import Any

import httpx
from nextloop import FinishReason, ModelResponse, ModelUsage, ProviderError

from agent4novel_nextloop.generation import run_generation


class ScriptedProvider:
    def __init__(self, response: ModelResponse) -> None:
        self.response = response
        self.requests: list[Any] = []

    async def complete(self, request: Any, *, attempt: int, cancel: Any) -> ModelResponse:
        self.requests.append(request)
        return self.response


def request() -> dict[str, Any]:
    return {
        "version": 1,
        "attemptId": "attempt-1",
        "system": "Return a JSON object.",
        "prompt": "Return ok=true.",
        "maxOutputTokens": 8000,
        "maxProviderAttempts": 1,
        "timeoutMs": 120000,
    }


async def test_returns_json_and_usage_from_agent_loop() -> None:
    provider = ScriptedProvider(
        ModelResponse(content='{"ok":true}', usage=ModelUsage(input_tokens=3, output_tokens=2))
    )

    result = await run_generation(request(), provider)

    assert result == {
        "kind": "succeeded",
        "content": {"ok": True},
        "finishReason": "stop",
        "usage": {"inputTokens": 3, "outputTokens": 2},
    }
    assert len(provider.requests) == 1
    candidate = provider.requests[0]
    assert candidate.session_id == "attempt-1"
    assert candidate.messages[0].role == "system"
    assert candidate.messages[0].content == "Return a JSON object."
    assert candidate.messages[1].role == "user"
    assert candidate.messages[1].content == "Return ok=true."
    assert candidate.tools == ()


async def test_rejects_invalid_json_without_exposing_provider_text() -> None:
    provider = ScriptedProvider(
        ModelResponse(
            content="PRIVATE_PROVIDER_TEXT",
            usage=ModelUsage(input_tokens=3, output_tokens=2),
        )
    )

    result = await run_generation(request(), provider)

    assert result == {
        "kind": "failed",
        "code": "llm-invalid-output",
        "retryable": True,
        "finishReason": "stop",
        "usage": {"inputTokens": 3, "outputTokens": 2},
    }
    assert "PRIVATE_PROVIDER_TEXT" not in str(result)


class FailingProvider:
    def __init__(self, error: ProviderError) -> None:
        self.error = error
        self.attempts = 0

    async def complete(self, request: Any, *, attempt: int, cancel: Any) -> ModelResponse:
        self.attempts += 1
        raise self.error


async def test_maps_provider_failure_without_exposing_error_body() -> None:
    provider = FailingProvider(ProviderError("PRIVATE_PROVIDER_TEXT", retryable=False))

    result = await run_generation(request(), provider)

    assert result == {
        "kind": "failed",
        "code": "llm-unavailable",
        "retryable": False,
        "finishReason": None,
        "usage": {"inputTokens": None, "outputTokens": None},
    }
    assert provider.attempts == 1
    assert "PRIVATE_PROVIDER_TEXT" not in str(result)


class TimeoutProvider:
    async def complete(self, request: Any, *, attempt: int, cancel: Any) -> ModelResponse:
        await cancel.wait()
        return ModelResponse(finish_reason=FinishReason.CANCELLED)


async def test_maps_turn_deadline_to_llm_timeout() -> None:
    timed_request = {**request(), "timeoutMs": 1}

    result = await run_generation(timed_request, TimeoutProvider())

    assert result == {
        "kind": "failed",
        "code": "llm-timeout",
        "retryable": True,
        "finishReason": "error",
        "usage": {"inputTokens": None, "outputTokens": None},
    }


async def test_maps_truncated_output_to_invalid_output() -> None:
    provider = ScriptedProvider(
        ModelResponse(
            content='{"truncated":',
            finish_reason=FinishReason.LENGTH,
            usage=ModelUsage(input_tokens=5, output_tokens=8000),
        )
    )

    result = await run_generation(request(), provider)

    assert result == {
        "kind": "failed",
        "code": "llm-invalid-output",
        "retryable": True,
        "finishReason": "length",
        "usage": {"inputTokens": 5, "outputTokens": 8000},
    }


async def test_honors_provider_attempt_budget() -> None:
    provider = FailingProvider(ProviderError("temporary", retryable=True))
    retrying_request = {**request(), "maxProviderAttempts": 3}

    result = await run_generation(retrying_request, provider)

    assert provider.attempts == 3
    assert result["code"] == "llm-unavailable"
    assert result["retryable"] is True


async def test_maps_httpx_timeout_to_llm_timeout() -> None:
    error = ProviderError("stream failed", retryable=True)
    error.__cause__ = httpx.ReadTimeout("synthetic timeout")
    provider = FailingProvider(error)

    result = await run_generation(request(), provider)

    assert result["code"] == "llm-timeout"
    assert result["retryable"] is True


async def test_rejects_empty_final_response_as_invalid_output() -> None:
    provider = ScriptedProvider(ModelResponse(content=""))

    result = await run_generation(request(), provider)

    assert result["code"] == "llm-invalid-output"
    assert result["retryable"] is True
