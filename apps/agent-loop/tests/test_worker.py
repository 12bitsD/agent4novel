import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class SSEServer:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("content-length", "0"))
                outer.requests.append(
                    {
                        "path": self.path,
                        "authorization": self.headers.get("authorization"),
                        "body": json.loads(self.rfile.read(length)),
                    }
                )
                chunks = [
                    {"choices": [{"delta": {"content": '{"ok":'}, "finish_reason": None}]},
                    {
                        "choices": [{"delta": {"content": "true}"}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 3, "completion_tokens": 2},
                    },
                ]
                payload = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
                payload += "data: [DONE]\n\n"
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.end_headers()
                self.wfile.write(payload.encode())

            def log_message(self, format: str, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base_url(self) -> str:
        host, port = self.server.server_address
        return f"http://{host}:{port}/v1"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


def worker_request(base_url: str) -> dict[str, Any]:
    return {
        "version": 1,
        "attemptId": "attempt-stdio",
        "system": "Return a JSON object.",
        "prompt": "Return ok=true.",
        "provider": {
            "modelId": "kimi-k2.8-highspeed",
            "baseUrl": base_url,
            "apiKeyEnv": "KIMI_API_KEY",
        },
        "parameters": {
            "temperature": 0.7,
            "top_p": 0.95,
            "thinking": {"type": "disabled"},
        },
        "maxOutputTokens": 8000,
        "maxProviderAttempts": 1,
        "timeoutMs": 1000,
    }


def test_stdio_worker_uses_real_nextloop_openai_provider() -> None:
    server = SSEServer()
    try:
        env = dict(os.environ, KIMI_API_KEY="synthetic-kimi-key")
        result = subprocess.run(
            [sys.executable, "-m", "agent4novel_nextloop.worker"],
            input=json.dumps(worker_request(server.base_url)),
            text=True,
            capture_output=True,
            env=env,
            timeout=5,
            check=False,
        )
    finally:
        server.close()

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "kind": "succeeded",
        "content": {"ok": True},
        "finishReason": "stop",
        "usage": {"inputTokens": 3, "outputTokens": 2},
    }
    assert result.stderr == ""
    assert len(server.requests) == 1
    request = server.requests[0]
    assert request["path"] == "/v1/chat/completions"
    assert request["authorization"] == "Bearer synthetic-kimi-key"
    assert request["body"] == {
        "model": "kimi-k2.8-highspeed",
        "messages": [
            {"role": "system", "content": "Return a JSON object."},
            {"role": "user", "content": "Return ok=true."},
        ],
        "stream": True,
        "response_format": {"type": "json_object"},
        "max_tokens": 8000,
        "temperature": 0.7,
        "top_p": 0.95,
        "thinking": {"type": "disabled"},
    }
