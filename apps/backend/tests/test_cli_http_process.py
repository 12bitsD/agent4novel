import json
import os
import socket
import subprocess
import time
from pathlib import Path

import httpx
from work_fixtures import SEED

ROOT = Path(__file__).resolve().parents[3]
A4N = ROOT / ".venv/bin/a4n"


def test_cli_commands_against_real_uvicorn(tmp_path: Path) -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "A4N_DATA_DIR": str(tmp_path),
        "A4N_HOST": "127.0.0.1",
        "A4N_PORT": str(port),
        "A4N_SERVE_WEB": "0",
    }
    process = subprocess.Popen(
        [str(ROOT / ".venv/bin/a4n-api")],
        cwd=ROOT,
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

        commands = [
            ["create", "--seed", SEED],
            ["advance"],
            ["select"],
            ["get", "--kind", "creative"],
            ["list"],
        ]
        work_id = ""
        results = []
        for command in commands:
            arguments = [str(A4N), *command]
            if command[0] in {"advance", "select", "get"}:
                arguments.append(work_id)
            arguments.extend(["--url", base])
            result = subprocess.run(
                arguments,
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            assert result.returncode == 0, (command, result.stderr)
            payload = json.loads(result.stdout)
            results.append(payload)
            if command[0] == "create":
                work_id = payload["id"]
        assert work_id
        assert results[1]["kind"] == "advanced"
        assert results[2]["humanStatus"] == "approved"
        assert results[3]["kind"] == "creative"
        assert [work["id"] for work in results[4]] == [work_id]
        smoke = subprocess.run(
            [str(A4N), "smoke", "--seed", SEED, "--url", base],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert smoke.returncode == 0, smoke.stderr
        smoke_result = json.loads(smoke.stdout)
        assert smoke_result["final"]["workflowState"] == "prose-approved"
        assert all(step["ok"] for step in smoke_result["steps"])
        assert not any(
            (artifact.get("chapter") or 0) > 1 for artifact in smoke_result["final"]["artifacts"]
        )
    finally:
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=10)
