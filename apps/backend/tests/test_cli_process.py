import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from work_fixtures import CAPTION, SEED

ROOT = Path(__file__).resolve().parents[3]
A4N = ROOT / ".venv/bin/a4n"


def test_executable_run_step_uses_python_live_provider(tmp_path: Path) -> None:
    requests: list[dict[str, Any]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            requests.append(json.loads(body))
            content = json.dumps(CAPTION, ensure_ascii=False)
            chunks = [
                {"choices": [{"delta": {"content": content}, "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}]},
                {"choices": [], "usage": {"prompt_tokens": 9, "completion_tokens": 3}},
            ]
            response = "".join(
                f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks
            )
            payload = (response + "data: [DONE]\n\n").encode()
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args: Any) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    seed = tmp_path / "seed.txt"
    seed.write_text(SEED)
    record = tmp_path / "record"
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "KIMI_API_KEY": "synthetic",
        "KIMI_BASE_URL": f"http://127.0.0.1:{server.server_port}",
    }
    try:
        result = subprocess.run(
            [
                str(A4N),
                "run-step",
                "caption",
                "--seed-file",
                str(seed),
                "--record-dir",
                str(record),
            ],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    assert output["kind"] == "succeeded"
    assert output["content"] == CAPTION
    assert output["recording"]["status"] == "complete"
    assert len(requests) == 1
    assert requests[0]["response_format"] == {"type": "json_object"}
    assert requests[0]["messages"][0]["role"] == "system"
    assert requests[0]["messages"][1]["content"] == f"作者原始素材:\n{SEED}\n\n请输出提炼稿。"
    invocation = json.loads((record / "invocation.json").read_text())
    assert invocation["captured"] is True
    assert invocation["maxOutputTokens"] == 8000
    assert json.loads((record / "meta.json").read_text())["complete"] is True
