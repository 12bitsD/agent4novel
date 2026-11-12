import os
import socket
import subprocess
import time
from pathlib import Path

import httpx
from work_fixtures import SEED

from agent4novel.store.sqlite import SqliteReadStore

ROOT = Path(__file__).resolve().parents[3]


def test_real_api_process_persists_demo_pipeline(tmp_path: Path) -> None:
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
                response = httpx.get(f"{base}/api/health", timeout=0.2)
                if response.status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.05)
        else:
            raise AssertionError("API process did not become ready")

        created = httpx.post(f"{base}/api/works", json={"seed": SEED}, timeout=10)
        assert created.status_code == 201, created.text
        work = created.json()
        advanced = httpx.post(f"{base}/api/works/{work['id']}/advance", timeout=10)
        assert advanced.status_code == 200, advanced.text
        outcome = advanced.json()
        assert outcome["kind"] == "advanced"
        assert outcome["stepId"] == "creative"
        assert outcome["telemetry"] == []
        view = httpx.get(f"{base}/api/works/{work['id']}", timeout=10).json()
        assert view["workflowState"] == "awaiting-selection"
        assert len(view["artifacts"]) == 2
    finally:
        process.terminate()
        process.wait(timeout=10)

    store = SqliteReadStore(tmp_path / "agent4novel.sqlite")
    stored = store.get_work(work["id"])
    assert stored is not None
    assert [artifact.kind for artifact in stored.artifacts] == ["caption", "creative"]
    assert stored.artifacts[0].humanStatus == "approved"
    assert stored.artifacts[1].humanStatus == "pending"
    store.close()
