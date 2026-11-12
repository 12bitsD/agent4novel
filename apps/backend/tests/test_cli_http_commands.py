import hashlib
import io
import json
from pathlib import Path
from typing import Any

import httpx
from fastapi.testclient import TestClient
from resource_fixtures import CONFIG_REQUEST_ID, SKILL_ID, SKILL_TEXT
from work_fixtures import OUTLINE, SEED

from agent4novel.cli import main
from agent4novel.main import create_app
from agent4novel.store.resources import SqliteResourceStore


class AppTransport(httpx.BaseTransport):
    def __init__(self, app: Any) -> None:
        self.client = TestClient(app)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        return self.client.request(
            request.method,
            str(request.url),
            content=request.content,
            headers=request.headers,
        )


def invoke(
    arguments: list[str], transport: httpx.BaseTransport, root: Path
) -> tuple[int, dict[str, Any], str, str]:
    stdout = io.StringIO()
    stderr = io.StringIO()
    code = main(
        arguments,
        env={"A4N_BASE_URL": "http://testserver"},
        root=root,
        stdout=stdout,
        stderr=stderr,
        transport=transport,
    )
    channel = stdout if code == 0 else stderr
    result = channel.getvalue().splitlines()[-1]
    return code, json.loads(result), stdout.getvalue(), stderr.getvalue()


def request_file(root: Path, name: str, value: Any) -> str:
    path = root / name
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return str(path)


def test_work_and_resource_commands_against_real_app(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    transport = AppTransport(
        create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store)
    )

    code, work, _, errors = invoke(["create", "--seed", SEED], transport, tmp_path)
    assert code == 0, errors
    work_id = work["id"]
    assert invoke(["list"], transport, tmp_path)[1][0]["id"] == work_id
    assert invoke(["config"], transport, tmp_path)[1]["demo"] is True
    outcome = invoke(["advance", work_id], transport, tmp_path)[1]
    assert outcome["kind"] == "advanced" and outcome["stepId"] == "creative"
    creative = invoke(["get", work_id, "--kind", "creative"], transport, tmp_path)[1]
    assert creative["humanStatus"] == "pending"
    selected = invoke(["select", work_id], transport, tmp_path)[1]
    assert selected["humanStatus"] == "approved"
    assert invoke(["advance", work_id], transport, tmp_path)[1]["stepId"] == "outline"
    outline_path = request_file(tmp_path, "outline.json", OUTLINE)
    saved = invoke(["save-outline", work_id, "--file", outline_path], transport, tmp_path)[1]
    approval_path = request_file(
        tmp_path,
        "outline-approval.json",
        {"expectedArtifactId": saved["id"], "expectedHeadVersion": saved["version"]},
    )
    approved = invoke(["approve-outline", work_id, "--file", approval_path], transport, tmp_path)[1]
    assert approved["id"] == saved["id"] and approved["humanStatus"] == "approved"
    assert invoke(["advance", work_id], transport, tmp_path)[1]["stepId"] == "setting"

    prompt_path = tmp_path / "prompt.md"
    prompt_path.write_text("Use concrete actions.")
    uploaded = invoke(
        ["upload-prompt", work_id, "--file", str(prompt_path), "--request-id", CONFIG_REQUEST_ID],
        transport,
        tmp_path,
    )[1]
    assert uploaded["id"] == CONFIG_REQUEST_ID
    skill_path = tmp_path / "SKILL.md"
    skill_path.write_text(SKILL_TEXT)
    assert (
        invoke(
            ["upload-skill", work_id, "--file", str(skill_path), "--request-id", SKILL_ID],
            transport,
            tmp_path,
        )[0]
        == 0
    )
    file = invoke(["get-agent-file", work_id, SKILL_ID], transport, tmp_path)[1]
    assert file["text"] == SKILL_TEXT
    assert file["file"]["sha256"] == hashlib.sha256(SKILL_TEXT.encode()).hexdigest()
    config_path = request_file(
        tmp_path,
        "config.json",
        {
            "requestId": CONFIG_REQUEST_ID,
            "expectedRevision": 0,
            "document": {
                "preferences": {"style": "简洁"},
                "defaults": {"model": "kimi:kimi-k2.8-highspeed"},
                "steps": {"prose": {"skills": [SKILL_ID]}},
            },
        },
    )
    receipt = invoke(["save-agent-config", work_id, "--file", config_path], transport, tmp_path)[1]
    assert receipt["revision"] == 1
    assert invoke(["agent-config", work_id], transport, tmp_path)[1]["revision"] == 1

    prose = store.append_artifact(work_id, "prose", {"text": "开头😀中段，结尾"}, chapter=1)
    sample_path = request_file(
        tmp_path,
        "bad.json",
        {
            "requestId": CONFIG_REQUEST_ID,
            "chapter": 1,
            "sourceArtifactId": prose.id,
            "sourceVersion": 1,
            "sourceHash": hashlib.sha256(prose.content.text.encode()).hexdigest(),
            "start": 2,
            "end": 6,
            "text": "😀中段",
            "note": "检查口吻",
        },
    )
    sample = invoke(["mark-bad-example", work_id, "--file", sample_path], transport, tmp_path)[1]
    assert sample["text"] == "😀中段"
    assert invoke(["bad-examples", work_id, "--chapter", "1"], transport, tmp_path)[1]["items"] == [
        sample
    ]
    assert invoke(["bad-example", work_id, CONFIG_REQUEST_ID], transport, tmp_path)[1] == sample
    assert invoke(["logs", work_id], transport, tmp_path)[1]["workId"] == work_id
    store.close()


def test_help_and_usage_are_zero_io(tmp_path: Path) -> None:
    calls = 0

    def fail(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise AssertionError("unexpected network I/O")

    transport = httpx.MockTransport(fail)
    stdout = io.StringIO()
    stderr = io.StringIO()
    assert main(["--help"], stdout=stdout, stderr=stderr, transport=transport) == 0
    assert stdout.getvalue() == "" and "run-step" in stderr.getvalue()
    for arguments in (
        ["create", "--seed-file", str(tmp_path / "missing"), "--unknown", "value"],
        ["create", "--seed", "a", "--seed-file", "unused"],
        ["bad-examples", "work", "--chapter", "0"],
        ["list", "--timeout-ms", "1"],
        ["get", "work", "--kind", "beat"],
    ):
        code, error, stdout_text, _ = invoke(arguments, transport, tmp_path)
        assert code == 1, (arguments, error)
        assert error["code"] in {"usage", "invalid-input"}
        assert stdout_text == ""
    assert calls == 0


def test_malformed_and_failed_writes_never_retry(tmp_path: Path) -> None:
    calls: list[httpx.Request] = []

    def malformed(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"workId": "wrong-work"}, request=request)

    code, error, _, _ = invoke(["create", "--seed", SEED], httpx.MockTransport(malformed), tmp_path)
    assert code == 1
    assert error["code"] == "invalid-response"
    assert error["details"]["writeOutcome"] == "unknown"
    assert len(calls) == 1

    def failed(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            500,
            json={"code": "internal-error", "message": "response unavailable", "retryable": False},
            request=request,
        )

    sample = request_file(
        tmp_path,
        "bad.json",
        {
            "requestId": CONFIG_REQUEST_ID,
            "chapter": 1,
            "sourceArtifactId": "artifact",
            "sourceVersion": 1,
            "sourceHash": "a" * 64,
            "start": 0,
            "end": 1,
            "text": "坏",
        },
    )
    code, error, _, _ = invoke(
        ["mark-bad-example", "work", "--file", sample],
        httpx.MockTransport(failed),
        tmp_path,
    )
    assert code == 1
    assert error["code"] == "internal-error"
    assert error["status"] == 500
    assert error["details"]["writeOutcome"] == "unknown"
    assert len(calls) == 2


def test_http_error_contract_is_not_accepted_for_wrong_work(tmp_path: Path) -> None:
    def wrong_work(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            500,
            json={
                "code": "commit-failed",
                "message": "commit-failed",
                "retryable": False,
                "command": {
                    "kind": "execution-result",
                    "requestId": "55555555-5555-4555-8555-555555555555",
                    "operation": "regenerate-beat",
                    "executionMode": "demo",
                    "latencyMs": 1,
                    "target": {"workId": "different", "kind": "beat", "chapter": 1},
                    "expectedHead": {"artifactId": "beat", "version": 1},
                    "writeOutcome": "unknown",
                    "failureStage": "commit",
                    "attemptIds": [],
                },
            },
            request=request,
        )

    code, error, _, _ = invoke(["advance", "work"], httpx.MockTransport(wrong_work), tmp_path)
    assert code == 1
    assert error["code"] == "invalid-response"
    assert error["details"]["writeOutcome"] == "unknown"


def test_start_chapter_response_matches_target() -> None:
    from agent4novel.cli_http import _matches_start_chapter

    assert _matches_start_chapter({"state": {"workId": "work"}}, "work", 1)
    command = {
        "operation": "generate-beat",
        "kind": "execution-result",
        "target": {"workId": "work", "kind": "beat", "chapter": 1},
    }
    assert _matches_start_chapter({"state": {"workId": "work"}, "beatCommand": command}, "work", 1)
    assert not _matches_start_chapter(
        {"state": {"workId": "work"}, "beatCommand": command}, "work", 2
    )
    assert not _matches_start_chapter({"state": {"workId": "work"}, "proseCommand": {}}, "work", 1)
    assert not _matches_start_chapter(
        {"state": {"workId": "other"}, "beatCommand": command}, "work", 1
    )
