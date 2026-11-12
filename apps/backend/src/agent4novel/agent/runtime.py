import asyncio
import hashlib
import json
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

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
    OpenAIProvider,
    ProviderError,
    ToolRegistry,
    TurnContext,
    TurnStatus,
)
from pydantic import BaseModel, ValidationError

from ..config import ModelConfigError, parse_model_id
from ..domain.diagnostics import LlmTelemetry, TelemetryBuffer
from ..domain.work import AgentConfig
from ..errors import KnownError
from .recording import InvocationRecorder, StepRecordError

DEFAULT_DEEPSEEK_MODEL_ID = "deepseek:deepseek-chat"
DEFAULT_LONGCAT_MODEL_ID = "longcat:LongCat-2.0"
DEFAULT_KIMI_MODEL_ID = "kimi:kimi-k2.8-highspeed"
MAX_SAFE_INTEGER = 9_007_199_254_740_991

ProviderFactory = Callable[..., ModelProvider]


@dataclass(frozen=True)
class ProviderConfig:
    model_id: str
    base_url: str
    api_key_env: str


@dataclass(frozen=True)
class GenerationSettings:
    parameters: dict[str, Any]
    options: dict[str, Any]


def _value(env: Mapping[str, str], name: str) -> str | None:
    text = env.get(name, "").strip()
    return text or None


def _base_url(env: Mapping[str, str], name: str, fallback: str) -> str:
    raw = _value(env, name) or fallback
    try:
        parsed = urlparse(raw)
        _ = parsed.port
        loopback = parsed.hostname == "localhost" or (
            parsed.hostname is not None
            and (parsed.hostname == "::1" or parsed.hostname.startswith("127."))
        )
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname is None
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or (parsed.scheme == "http" and not loopback)
        ):
            raise ModelConfigError(f"{name} must be an absolute safe http(s) URL")
    except ValueError as error:
        if isinstance(error, ModelConfigError):
            raise
        raise ModelConfigError(f"{name} must be an absolute http(s) URL") from error
    return raw.rstrip("/")


def _timeout_ms(env: Mapping[str, str]) -> int:
    raw = _value(env, "A4N_LLM_TIMEOUT_MS")
    if raw is None:
        return 120_000
    try:
        value = int(raw)
    except ValueError as error:
        raise ModelConfigError(
            "A4N_LLM_TIMEOUT_MS must be an integer between 1000 and 900000"
        ) from error
    if str(value) != raw or not 1_000 <= value <= 900_000:
        raise ModelConfigError("A4N_LLM_TIMEOUT_MS must be an integer between 1000 and 900000")
    return value


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
    try:
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
    except Exception:
        return {
            "kind": "failed",
            "code": "llm-unavailable",
            "retryable": True,
            "finishReason": None,
            "usage": {"inputTokens": None, "outputTokens": None},
        }
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
        context_limit = observed.error is not None and any(
            marker in str(observed.error)
            for marker in ("context_length_exceeded", "max_context_length")
        )
        return {
            "kind": "failed",
            "code": code,
            "retryable": retryable,
            **({"category": "context-limit"} if context_limit else {}),
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


def _hash12(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="surrogatepass")).hexdigest()[:12]


def _utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def _safe_tokens(value: object) -> int | None:
    if type(value) is int and 0 <= value <= MAX_SAFE_INTEGER:
        return value
    return None


def _log(event: str, telemetry: LlmTelemetry) -> None:
    record = {"event": event, **telemetry.model_dump(mode="json", exclude_none=True)}
    logging.getLogger("agent4novel").info(json.dumps(record, ensure_ascii=False))


class ModelRuntime:
    def __init__(
        self,
        env: Mapping[str, str],
        *,
        provider_factory: ProviderFactory | None = None,
        telemetry: TelemetryBuffer | None = None,
    ) -> None:
        self.env = env
        self.deepseek_key = _value(env, "DEEPSEEK_API_KEY")
        self.longcat_key = _value(env, "LONGCAT_API_KEY")
        self.kimi_key = _value(env, "KIMI_API_KEY") or _value(env, "MOONSHOT_API_KEY")
        explicit = _value(env, "A4N_MODEL")
        self.default_model_id = (
            parse_model_id(explicit)
            if explicit
            else DEFAULT_DEEPSEEK_MODEL_ID
            if self.deepseek_key
            else DEFAULT_LONGCAT_MODEL_ID
            if self.longcat_key
            else DEFAULT_KIMI_MODEL_ID
            if self.kimi_key
            else DEFAULT_DEEPSEEK_MODEL_ID
        )
        if explicit and not self._configured(self.default_model_id):
            provider = self.default_model_id.split(":", 1)[0]
            raise ModelConfigError(
                f'A4N_MODEL selects provider "{provider}" but its API key is missing'
            )
        self.providers = {
            "deepseek": (
                _base_url(env, "DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
                "DEEPSEEK_API_KEY",
            ),
            "longcat": (
                _base_url(env, "LONGCAT_BASE_URL", "https://api.longcat.chat/openai/v1"),
                "LONGCAT_API_KEY",
            ),
            "kimi": (
                _base_url(env, "KIMI_BASE_URL", "https://api.moonshot.cn/v1"),
                "KIMI_API_KEY" if _value(env, "KIMI_API_KEY") else "MOONSHOT_API_KEY",
            ),
        }
        self.request_timeout_ms = _timeout_ms(env)
        self.provider_factory = provider_factory or OpenAIProvider
        self.telemetry = telemetry or TelemetryBuffer()

    @property
    def mode(self) -> Literal["demo", "live"]:
        return "live" if self._configured(self.default_model_id) else "demo"

    def _configured(self, model: str) -> bool:
        return bool(
            self.deepseek_key
            if model.startswith("deepseek:")
            else self.kimi_key
            if model.startswith("kimi:")
            else self.longcat_key
        )

    def provider_config(self, model_override: str | None = None) -> ProviderConfig:
        try:
            model = parse_model_id(model_override or self.default_model_id)
        except ModelConfigError as error:
            raise KnownError("llm-unavailable", str(error), retryable=False) from error
        if not self._configured(model):
            provider = model.split(":", 1)[0]
            raise KnownError(
                "llm-unavailable", f'LLM provider "{provider}" is not configured', retryable=False
            )
        provider = model.split(":", 1)[0]
        base_url, key_name = self.providers[provider]
        return ProviderConfig(model.split(":", 1)[1], base_url, key_name)

    def generation_settings(self, config: AgentConfig) -> GenerationSettings:
        model = config.model or self.default_model_id
        longcat = model.startswith("longcat:")
        if config.thinking is not None and not longcat:
            raise KnownError(
                "llm-unavailable", "thinking control requires LongCat-2.0", retryable=False
            )
        parameters: dict[str, Any] = {}
        if longcat:
            parameters = {"thinking": "disabled", "temperature": 0.9, "topP": 0.95}
        for key in ("thinking", "temperature", "topP"):
            value = getattr(config, key)
            if value is not None:
                parameters[key] = value
        thinking = parameters.get("thinking")
        options = {
            key: value for key, value in parameters.items() if key in {"temperature", "topP"}
        }
        if thinking is not None:
            options["providerOptions"] = {"longcat": {"thinking": {"type": thinking}}}
        return GenerationSettings(parameters, options)

    async def call_llm(
        self,
        *,
        output_type: type[BaseModel],
        system: str,
        prompt: str,
        config: AgentConfig,
        work_id: str,
        step_id: str,
        attempt_id: str,
        chapter: int | None = None,
        request_id: str | None = None,
        max_output_tokens: int = 8000,
        max_provider_attempts: int = 3,
        max_retries: int | None = None,
        direction_count: int | None = None,
        recorder: InvocationRecorder | None = None,
    ) -> BaseModel:
        started = time.monotonic()
        model = config.model or self.default_model_id
        try:
            parse_model_id(model)
            safe_model = model
        except ModelConfigError:
            safe_model = "unrecognized-model"
        generation: dict[str, Any] | None = None
        try:
            provider = self.provider_config(model)
            settings = self.generation_settings(config)
            generation = settings.parameters
            options = dict(settings.options)
            thinking = options.pop("providerOptions", None)
            parameters: dict[str, Any] = {
                **options,
                "max_tokens": max_output_tokens,
                "response_format": {"type": "json_object"},
            }
            if "topP" in parameters:
                parameters["top_p"] = parameters.pop("topP")
            if thinking is not None:
                parameters.update(thinking["longcat"])
            key = _value(self.env, provider.api_key_env)
            if key is None:
                raise KnownError(
                    "llm-unavailable", "LLM provider is not configured", retryable=False
                )
            if recorder is not None:
                recorder.capture(
                    {
                        "system": system,
                        "prompt": prompt,
                        "model": model,
                        "attemptId": attempt_id,
                        "effectiveConfig": {
                            "model": model,
                            "directionCount": direction_count,
                            "thinking": generation.get("thinking"),
                            "temperature": generation.get("temperature"),
                            "topP": generation.get("topP"),
                        },
                        "generation": {
                            "thinking": generation.get("thinking"),
                            "temperature": generation.get("temperature"),
                            "topP": generation.get("topP"),
                        },
                        "sdkOptions": {
                            "temperature": options.get("temperature"),
                            "topP": options.get("topP"),
                            "providerOptions": thinking,
                        },
                        "maxOutputTokens": max_output_tokens,
                        "maxRetries": max_retries,
                        "requestTimeoutMs": self.request_timeout_ms,
                    }
                )
            attempts = max_retries + 1 if max_retries is not None else max_provider_attempts
            llm_provider = self.provider_factory(
                model_id=provider.model_id,
                base_url=provider.base_url,
                api_key=key,
                default_parameters=parameters,
                timeout_seconds=self.request_timeout_ms / 1000,
            )
            result = await run_generation(
                {
                    "attemptId": attempt_id,
                    "system": system,
                    "prompt": prompt,
                    "maxOutputTokens": max_output_tokens,
                    "maxProviderAttempts": attempts,
                    "timeoutMs": self.request_timeout_ms,
                },
                llm_provider,
            )
            if result["kind"] != "succeeded":
                raise _GenerationFailure(result)
            validated = output_type.model_validate(result["content"])
            telemetry = self._telemetry(
                work_id=work_id,
                step_id=step_id,
                chapter=chapter,
                request_id=request_id,
                attempt_id=attempt_id,
                model=safe_model,
                config=config,
                generation=generation,
                prompt=prompt,
                system=system,
                started=started,
                ok=True,
                usage=result["usage"],
                finish_reason=result["finishReason"],
            )
            self.telemetry.record_telemetry(work_id, telemetry)
            _log("llm.call", telemetry)
            return validated
        except Exception as error:
            if isinstance(error, StepRecordError):
                raise
            if isinstance(error, KnownError) and error.code not in {
                "llm-timeout",
                "llm-invalid-output",
                "llm-unavailable",
            }:
                raise
            failure = error.result if isinstance(error, _GenerationFailure) else {}
            category = (
                "context-limit"
                if failure.get("category") == "context-limit"
                else "timeout"
                if failure.get("code") == "llm-timeout"
                else "output-truncated"
                if failure.get("finishReason") == "length"
                else "output-schema"
                if failure.get("code") == "llm-invalid-output" or isinstance(error, ValidationError)
                else "configuration"
                if isinstance(error, KnownError) and not error.retryable
                else "network"
                if isinstance(error, _GenerationFailure)
                else "unknown"
            )
            telemetry = self._telemetry(
                work_id=work_id,
                step_id=step_id,
                chapter=chapter,
                request_id=request_id,
                attempt_id=attempt_id,
                model=safe_model,
                config=config,
                generation=generation,
                prompt=prompt,
                system=system,
                started=started,
                ok=False,
                usage=failure.get("usage", {}),
                finish_reason=failure.get("finishReason"),
                error=category,
            )
            self.telemetry.record_telemetry(work_id, telemetry)
            _log("llm.error", telemetry)
            if isinstance(error, KnownError) and error.code in {
                "llm-timeout",
                "llm-invalid-output",
                "llm-unavailable",
            }:
                raise
            code = failure.get("code")
            if code is None:
                code = (
                    "llm-invalid-output"
                    if isinstance(error, ValidationError)
                    else "llm-unavailable"
                )
            message = {
                "llm-timeout": "llm request timed out",
                "llm-invalid-output": "llm output failed schema validation",
            }.get(code, "llm request unavailable")
            retryable = failure.get("retryable", True)
            raise KnownError(code, message, retryable=retryable, attempt_id=attempt_id) from error

    def _telemetry(
        self,
        *,
        work_id: str,
        step_id: str,
        chapter: int | None,
        request_id: str | None,
        attempt_id: str,
        model: str,
        config: AgentConfig,
        generation: dict[str, Any] | None,
        prompt: str,
        system: str,
        started: float,
        ok: bool,
        usage: Mapping[str, Any],
        finish_reason: object,
        error: str | None = None,
    ) -> LlmTelemetry:
        elapsed = max(0, int((time.monotonic() - started) * 1000))
        values: dict[str, Any] = {
            "requestId": request_id,
            "stepId": step_id,
            "chapter": chapter,
            "attemptId": attempt_id,
            "model": model,
            "ok": ok,
            "latencyMs": elapsed,
            "inputTokens": _safe_tokens(usage.get("inputTokens")),
            "outputTokens": _safe_tokens(usage.get("outputTokens")),
            "finishReason": finish_reason if isinstance(finish_reason, str) else "unknown",
            "generation": generation,
            "promptChars": _utf16_length(prompt),
            "promptHash": _hash12(prompt),
            "systemHash": _hash12(system),
            "configRevision": config.configRevision,
            "configFiles": config.configFiles,
            "error": error,
        }
        return LlmTelemetry.model_validate(
            {key: value for key, value in values.items() if value is not None}
        )


class _GenerationFailure(Exception):
    def __init__(self, result: Mapping[str, Any]) -> None:
        super().__init__(str(result.get("code", "llm-unavailable")))
        self.result = result
