import asyncio
import json
from collections.abc import Mapping
from typing import Any

import httpx
from nextloop import (
    AgentLoop,
    CandidateRequest,
    FinishReason,
    InMemoryEventStore,
    LoopConfig,
    MemoryDeliveryOwner,
    ModelProvider,
    ModelResponse,
    ProviderError,
    ToolRegistry,
    TurnContext,
    TurnStatus,
)


class _ObservedProvider:
    def __init__(self, delegate: ModelProvider) -> None:
        self.delegate = delegate
        self.response: ModelResponse | None = None
        self.error: ProviderError | None = None

    async def complete(
        self, request: CandidateRequest, *, attempt: int, cancel: asyncio.Event
    ) -> ModelResponse:
        try:
            self.response = await self.delegate.complete(request, attempt=attempt, cancel=cancel)
        except ProviderError as error:
            self.error = error
            raise
        return self.response


def _finish_reason(value: FinishReason | None) -> str | None:
    if value is None:
        return None
    return {
        FinishReason.STOP: "stop",
        FinishReason.TOOL_CALLS: "tool-calls",
        FinishReason.LENGTH: "length",
        FinishReason.CONTENT_FILTER: "content-filter",
        FinishReason.ERROR: "error",
        FinishReason.CANCELLED: "error",
    }[value]


async def run_generation(request: Mapping[str, Any], provider: ModelProvider) -> dict[str, Any]:
    observed = _ObservedProvider(provider)
    delivery = MemoryDeliveryOwner()
    outcome = await AgentLoop().run(
        TurnContext(
            session_id=str(request["attemptId"]),
            input_id=f"{request['attemptId']}-input",
            initial_input=str(request["prompt"]),
            config=LoopConfig(
                system_prompt=str(request["system"]),
                context_window=2_000_000_000,
                output_reserve=0,
                max_protocol_corrections=0,
                max_provider_attempts=int(request["maxProviderAttempts"]),
                max_steps=1,
                max_model_calls=int(request["maxProviderAttempts"]),
                max_output_tokens=int(request["maxOutputTokens"]),
                turn_deadline_seconds=float(request["timeoutMs"]) / 1000,
            ),
            store=InMemoryEventStore(),
            provider=observed,
            tools=ToolRegistry(),
            delivery=delivery,
        )
    )
    response = observed.response
    usage = response.usage if response is not None else None
    if outcome.status != TurnStatus.SUCCEEDED or len(delivery.messages) != 1:
        provider_timed_out = observed.error is not None and isinstance(
            observed.error.__cause__, (TimeoutError, httpx.TimeoutException)
        )
        timed_out = outcome.error == "turn_deadline_exceeded" or provider_timed_out
        invalid_output = response is not None and (
            response.finish_reason in {FinishReason.LENGTH, FinishReason.TOOL_CALLS}
            or not response.content.strip()
        )
        code = (
            "llm-timeout"
            if timed_out
            else "llm-invalid-output"
            if invalid_output
            else "llm-unavailable"
        )
        retryable = (
            timed_out
            or invalid_output
            or (observed.error.retryable if observed.error is not None else True)
        )
        return {
            "kind": "failed",
            "code": code,
            "retryable": retryable,
            "finishReason": _finish_reason(
                response.finish_reason if response is not None else None
            ),
            "usage": {
                "inputTokens": usage.input_tokens if usage is not None else None,
                "outputTokens": usage.output_tokens if usage is not None else None,
            },
        }
    try:
        content = json.loads(delivery.messages[0].content)
    except json.JSONDecodeError:
        return {
            "kind": "failed",
            "code": "llm-invalid-output",
            "retryable": True,
            "finishReason": _finish_reason(
                response.finish_reason if response is not None else None
            ),
            "usage": {
                "inputTokens": usage.input_tokens if usage is not None else None,
                "outputTokens": usage.output_tokens if usage is not None else None,
            },
        }
    return {
        "kind": "succeeded",
        "content": content,
        "finishReason": _finish_reason(response.finish_reason if response is not None else None),
        "usage": {
            "inputTokens": usage.input_tokens if usage is not None else None,
            "outputTokens": usage.output_tokens if usage is not None else None,
        },
    }
