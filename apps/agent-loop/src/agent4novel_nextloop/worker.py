import asyncio
import json
import os
import sys
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlparse

from nextloop import OpenAIProvider

from .generation import run_generation

MAX_REQUEST_BYTES = 1024 * 1024
API_KEY_ENVIRONMENTS = {
    "DEEPSEEK_API_KEY",
    "LONGCAT_API_KEY",
    "KIMI_API_KEY",
    "MOONSHOT_API_KEY",
}


def _string(value: Any, *, nonempty: bool = False) -> str:
    if not isinstance(value, str) or (nonempty and not value.strip()):
        raise ValueError("invalid string")
    return value


def _integer(value: Any) -> int:
    if type(value) is not int or value <= 0:
        raise ValueError("invalid positive integer")
    return value


def _base_url(value: Any) -> str:
    raw = _string(value)
    parsed = urlparse(raw)
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"} or (
        parsed.hostname is not None and parsed.hostname.startswith("127.")
    )
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname is None
        or (parsed.scheme == "http" and not loopback)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("unsafe provider base URL")
    _ = parsed.port
    return raw.rstrip("/")


def _request() -> Mapping[str, Any]:
    payload = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(payload) > MAX_REQUEST_BYTES:
        raise ValueError("request too large")
    value = json.loads(payload)
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("invalid request")
    _string(value["attemptId"], nonempty=True)
    _string(value["system"])
    _string(value["prompt"])
    _integer(value["maxOutputTokens"])
    _integer(value["maxProviderAttempts"])
    _integer(value["timeoutMs"])
    provider = value["provider"]
    if not isinstance(provider, dict):
        raise ValueError("invalid provider")
    _string(provider["modelId"], nonempty=True)
    provider["baseUrl"] = _base_url(provider["baseUrl"])
    if provider["apiKeyEnv"] not in API_KEY_ENVIRONMENTS:
        raise ValueError("invalid credential environment")
    return value


def _provider(request: Mapping[str, Any]) -> OpenAIProvider:
    config = request["provider"]
    key_name = str(config["apiKeyEnv"])
    api_key = os.environ.get(key_name, "").strip()
    if not api_key:
        raise ValueError("missing provider credential")
    parameters = request.get("parameters", {})
    if not isinstance(parameters, dict):
        raise ValueError("invalid provider parameters")
    return OpenAIProvider(
        model_id=str(config["modelId"]),
        base_url=str(config["baseUrl"]),
        api_key=api_key,
        default_parameters={
            **parameters,
            "max_tokens": _integer(request["maxOutputTokens"]),
            "response_format": {"type": "json_object"},
        },
        timeout_seconds=_integer(request["timeoutMs"]) / 1000,
    )


def main() -> int:
    try:
        request = _request()
        result = asyncio.run(run_generation(request, _provider(request)))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        result = {"kind": "failed", "code": "invalid-input", "retryable": False}
    except Exception:
        result = {"kind": "failed", "code": "llm-unavailable", "retryable": True}
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    return 0 if result.get("kind") == "succeeded" else 1


if __name__ == "__main__":
    raise SystemExit(main())
