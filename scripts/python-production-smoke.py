import hashlib
import json
import os
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[1]
A4N = ROOT / ".venv/bin/a4n"
CAPTION = {
    "inputStage": "脑洞",
    "summary": "合成提炼稿。",
    "elements": [{"kind": "人物", "content": "主角"}],
    "gaps": [],
}
CREATIVE = {
    "directions": [
        {
            "title": f"合成方向{index}",
            "hook": "钩子",
            "tags": [],
            "synopsis": "合成概要",
            "characters": [],
            "setting": [],
            "payoffs": [],
            "outline": [],
        }
        for index in (1, 2)
    ]
}


def chunks(value: Any) -> bytes:
    events = [
        {
            "choices": [
                {
                    "delta": {"content": json.dumps(value, ensure_ascii=False)},
                    "finish_reason": None,
                }
            ]
        },
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
        {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 10}},
    ]
    return (
        "".join(
            f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in events
        )
        + "data: [DONE]\n\n"
    ).encode()


def main() -> None:
    systems: list[str] = []
    requests: list[dict[str, Any]] = []

    class Provider(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            try:
                request = json.loads(
                    self.rfile.read(int(self.headers["content-length"]))
                )
                requests.append(request)
                assert request["model"] == "kimi-k2.8-highspeed"
                assert request["temperature"] == 0.25
                assert request["top_p"] == 0.8
                assert request["response_format"] == {"type": "json_object"}
                system = request["messages"][0]["content"]
                assert "AUTHOR_GUIDANCE_SENTINEL" in system
                systems.append(system)
                assert len(requests) <= 2
                payload = chunks(CAPTION if len(requests) == 1 else CREATIVE)
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except (AssertionError, KeyError, TypeError, ValueError):
                self.send_response(500)
                self.end_headers()

        def log_message(self, format: str, *args: Any) -> None:
            return

    provider = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    thread = threading.Thread(target=provider.serve_forever, daemon=True)
    thread.start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with TemporaryDirectory(prefix="a4n-python-production-") as directory:
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": os.environ.get("HOME", ""),
            "A4N_ROOT": str(ROOT),
            "A4N_DATA_DIR": directory,
            "A4N_HOST": "127.0.0.1",
            "A4N_PORT": str(port),
            "A4N_SERVE_WEB": "1",
            "A4N_MODEL": "kimi:kimi-k2.8-highspeed",
            "KIMI_API_KEY": "synthetic-local-test",
            "KIMI_BASE_URL": f"http://127.0.0.1:{provider.server_port}",
            "A4N_LLM_TIMEOUT_MS": "10000",
            "NO_PROXY": "127.0.0.1,localhost,::1",
            "no_proxy": "127.0.0.1,localhost,::1",
        }
        process = subprocess.Popen(
            [str(ROOT / ".venv/bin/a4n-api")],
            cwd=directory,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        base = f"http://127.0.0.1:{port}"
        try:
            for _ in range(200):
                if process.poll() is not None:
                    _, errors = process.communicate(timeout=1)
                    raise AssertionError(f"API process exited early: {errors[-2000:]}")
                try:
                    if httpx.get(f"{base}/api/health", timeout=0.2).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.05)
            else:
                raise AssertionError("API process did not become ready")
            assert httpx.get(f"{base}/", timeout=10).status_code == 200

            def cli(*args: str) -> Any:
                result = subprocess.run(
                    [str(A4N), *args, "--url", base],
                    cwd=directory,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
                assert result.returncode == 0, result.stderr
                assert "synthetic-local-test" not in result.stdout + result.stderr
                assert "AUTHOR_GUIDANCE_SENTINEL" not in result.stdout + result.stderr
                return json.loads(result.stdout.splitlines()[-1])

            work = cli("create", "--seed", "本地生产合成素材")
            prompt_path = Path(directory) / "prompt.md"
            prompt_path.write_text("AUTHOR_GUIDANCE_SENTINEL: concise writing.")
            prompt = cli(
                "upload-prompt",
                work["id"],
                "--file",
                str(prompt_path),
                "--request-id",
                str(uuid4()),
            )
            config_path = Path(directory) / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "requestId": str(uuid4()),
                        "expectedRevision": 0,
                        "document": {
                            "preferences": {"genre": "mock-genre"},
                            "defaults": {
                                "model": "kimi:kimi-k2.8-highspeed",
                                "systemPromptRef": prompt["id"],
                                "temperature": 0.25,
                                "topP": 0.8,
                            },
                            "steps": {},
                        },
                    }
                )
            )
            cli("save-agent-config", work["id"], "--file", str(config_path))
            assert cli("agent-config", work["id"])["revision"] == 1
            outcome = cli("advance", work["id"])
            assert outcome["kind"] == "advanced" and outcome["stepId"] == "creative", (
                outcome,
                len(requests),
                [
                    {
                        "model": request.get("model"),
                        "temperature": request.get("temperature"),
                        "top_p": request.get("top_p"),
                        "response_format": request.get("response_format"),
                    }
                    for request in requests
                ],
            )
            assert len(requests) == 2
            assert [entry["ok"] for entry in outcome["telemetry"]] == [True, True]
            assert [entry["configRevision"] for entry in outcome["telemetry"]] == [1, 1]
            assert [entry["systemHash"] for entry in outcome["telemetry"]] == [
                hashlib.sha256(system.encode()).hexdigest()[:12] for system in systems
            ]
            assert not systems[0].find("mock-genre") >= 0
            assert "mock-genre" in systems[1]
            print(
                "PASS: Python API/CLI, packaged Web, actual provider schema, sampling and telemetry via loopback mock"
            )
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    provider.shutdown()
    provider.server_close()
    thread.join(timeout=2)


if __name__ == "__main__":
    main()
