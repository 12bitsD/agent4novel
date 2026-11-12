import sqlite3
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from test_cli_http_commands import invoke, request_file
from test_submissions import artifact, successful_beat, view
from work_fixtures import BEAT, PROSE, SEED

from agent4novel.domain.commands import BeatCommandErrorBody, ProseCommandErrorBody
from agent4novel.domain.resources import (
    ArtifactRef,
    AuthorConfigReceipt,
    AuthorConfigView,
    BadExamplePage,
)
from agent4novel.domain.work import AgentConfig, ArtifactInput, ChapterSummary
from agent4novel.main import DEMO_WORKS, create_app
from agent4novel.services.submissions import recover_submission
from agent4novel.store.memory import InMemoryStore
from agent4novel.store.resources import SqliteResourceStore
from agent4novel.store.sqlite import SqliteInitializationError, initialize_sqlite_database
from agent4novel.store.work import ArtifactHead, ArtifactPrecondition, SqliteStore

MAX_SAFE = 9_007_199_254_740_991
REQUEST_ID = "55555555-5555-4555-8555-555555555555"


def test_version_fields_reject_values_above_safe_integer() -> None:
    with pytest.raises(ValidationError):
        ArtifactInput(kind="caption", artifactId="caption", version=MAX_SAFE + 1)
    with pytest.raises(ValidationError):
        ArtifactRef(artifactId="setting", version=MAX_SAFE + 1)
    with pytest.raises(ValidationError):
        ChapterSummary(
            chapter=MAX_SAFE + 1,
            title="章",
            beatStatus=None,
            proseStatus=None,
            allowedActions=[],
            needsContinuityReview=False,
        )
    with pytest.raises(ValidationError):
        AuthorConfigReceipt(
            workId="work",
            requestId=REQUEST_ID,
            revision=MAX_SAFE + 1,
            document={"preferences": {}, "defaults": {}, "steps": {}},
        )
    with pytest.raises(ValidationError):
        BadExamplePage(workId="work", items=[], nextCursor=MAX_SAFE + 1)


@pytest.mark.parametrize("backend", ["memory", "sqlite"])
def test_seed_preview_uses_utf16_units(backend: str, tmp_path: Path) -> None:
    store = InMemoryStore() if backend == "memory" else SqliteStore(tmp_path / "agent4novel.sqlite")
    work = store.create_work("😀" * 41)
    assert store.list_works()[0].seedPreview == "😀" * 20 + "…"
    assert work.title == "😀" * 10
    store.close()


@pytest.mark.parametrize("backend", ["memory", "sqlite"])
def test_seed_demo_is_atomic_and_idempotent(backend: str, tmp_path: Path) -> None:
    store = (
        InMemoryStore()
        if backend == "memory"
        else SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    )
    for _ in range(2):
        client = TestClient(create_app({"A4N_SEED_DEMO": "1"}, root=tmp_path, store=store))
        works = client.get("/api/works").json()
        assert len(works) == 3
        assert {work["title"] for work in works} == {"都市异能：读心校草", "玄界九境", "迷雾镇"}
    store.create_work("另一部作品")
    client = TestClient(create_app({"A4N_SEED_DEMO": "1"}, root=tmp_path, store=store))
    assert len(client.get("/api/works").json()) == 4
    store.close()


class FaultConnection(sqlite3.Connection):
    def __init__(self, busy: tuple[int, ...] = (), stage: str | None = None) -> None:
        super().__init__(":memory:")
        self.row_factory = sqlite3.Row
        self.busy = busy
        self.stage = stage
        self.calls = 0

    def execute(self, sql: str, *args: Any) -> Any:
        if sql == "PRAGMA foreign_keys = ON":
            self.calls += 1
            if self.calls <= len(self.busy):
                error = sqlite3.OperationalError("synthetic busy")
                error.sqlite_errorcode = self.busy[self.calls - 1]
                raise error
        if self.stage == "foreign_keys" and sql == "PRAGMA foreign_keys = ON":
            raise sqlite3.OperationalError("synchronous startup failure")
        if self.stage == "wal" and sql == "PRAGMA journal_mode = WAL":
            raise sqlite3.OperationalError("synchronous startup failure")
        if self.stage == "synchronous" and sql == "PRAGMA synchronous = FULL":
            raise sqlite3.OperationalError("synchronous startup failure")
        return super().execute(sql, *args)


@pytest.mark.parametrize(
    "code",
    [
        sqlite3.SQLITE_BUSY,
        sqlite3.SQLITE_BUSY_RECOVERY,
        sqlite3.SQLITE_BUSY_SNAPSHOT,
        sqlite3.SQLITE_BUSY_TIMEOUT,
    ],
)
def test_initialization_retries_only_transient_busy_codes(code: int, monkeypatch) -> None:
    monkeypatch.setattr("agent4novel.store.sqlite.initialize_sqlite_schema", lambda db: None)
    db = FaultConnection(busy=(code,))
    initialize_sqlite_database(db, max_attempts=2, memory=True)
    assert db.calls == 2
    db.close()


def test_initialization_reports_locked_and_each_stage(monkeypatch) -> None:
    monkeypatch.setattr("agent4novel.store.sqlite.initialize_sqlite_schema", lambda db: None)
    db = FaultConnection(busy=(6,))
    with pytest.raises(SqliteInitializationError) as error:
        initialize_sqlite_database(db, max_attempts=2, memory=True)
    assert error.value.sqlite_code == "SQLITE_LOCKED"
    assert error.value.attempts == 1 and error.value.retryable is False
    assert db.calls == 1
    db.close()
    for stage in ("foreign_keys", "wal", "synchronous"):
        db = FaultConnection(stage=stage)
        with pytest.raises(SqliteInitializationError) as error:
            initialize_sqlite_database(db, max_attempts=2, memory=stage == "synchronous")
        assert error.value.stage == stage
        assert error.value.attempts == 1 and error.value.retryable is False
        db.close()


def test_public_write_bodies_are_bounded_without_writes(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    for method, path in (
        ("POST", "/api/works"),
        ("PUT", "/api/works/work/artifacts/creative"),
        ("POST", "/api/works/work/artifacts/creative/select"),
        ("PUT", "/api/works/work/artifacts/outline"),
        ("POST", "/api/works/work/approve"),
    ):
        response = client.request(method, path, content=b" " * 1_048_577)
        assert response.status_code == 413, (path, response.status_code)
        assert response.json()["code"] == "payload-too-large"
    assert store.list_works() == []
    store.close()


@pytest.mark.parametrize("kind", ["beat", "prose"])
def test_wrong_artifact_kind_is_not_a_successful_command(kind: str) -> None:
    baseline = artifact(kind, BEAT if kind == "beat" else PROSE)
    wrong = artifact("prose" if kind == "beat" else "beat", PROSE if kind == "beat" else BEAT)
    wrong = wrong.model_copy(update={"version": 2})
    response = {
        "status": 200,
        "body": {
            "artifact": wrong.model_dump(),
            "command": {
                "kind": "execution-result",
                "requestId": REQUEST_ID,
                "operation": f"regenerate-{kind}",
                "executionMode": "demo",
                "latencyMs": 1,
                "target": {"workId": baseline.workId, "kind": kind, "chapter": 1},
                "expectedHead": {"artifactId": baseline.id, "version": 1},
                "writeOutcome": "committed",
                "resultHead": {"artifactId": wrong.id, "version": 2, "humanStatus": "pending"},
                "attemptIds": [],
            },
            "workflow": {
                "workflowState": f"awaiting-{kind}-review",
                "nextStepId": None,
                "allowedActions": [],
            },
            "telemetry": [],
        },
    }
    result = recover_submission(
        kind,
        baseline,
        f"regenerate-{kind}",
        {
            "chapter": 1,
            "expectedArtifactId": baseline.id,
            "expectedHeadVersion": 1,
            "content": baseline.content.model_dump(),
            "instructions": "重写",
        },
        False,
        response,
    )
    assert result.resolution == "uncertain"
    assert result.hasUnknownWrite is True
    assert result.artifact is None


def test_cli_rejects_oversized_error_envelope(tmp_path: Path) -> None:
    def oversized(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            500,
            json={"code": "internal-error", "message": "x" * 2_000_000, "retryable": False},
            request=request,
        )

    code, error, _, _ = invoke(["advance", "work"], httpx.MockTransport(oversized), tmp_path)
    assert code == 1
    assert error["code"] == "invalid-response"
    assert error["details"]["writeOutcome"] == "unknown"


def test_cli_rejects_stale_creative_selection(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    app = create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store)
    api = TestClient(app)
    work = api.post("/api/works", json={"seed": SEED}).json()
    api.post(f"/api/works/{work['id']}/advance")
    creative = store.get_work(work["id"]).artifacts[-1]
    candidates = [
        creative.model_copy(update={"humanStatus": "approved"}),
        creative.model_copy(
            update={"id": "creative-forged", "version": 2, "humanStatus": "approved"}
        ),
    ]

    for candidate in candidates:

        def stale_response(request: httpx.Request, candidate: Any = candidate) -> httpx.Response:
            if request.url.path.endswith("/select"):
                return httpx.Response(200, json=candidate.model_dump(mode="json"), request=request)
            return api.request(
                request.method, str(request.url), content=request.content, headers=request.headers
            )

        code, error, _, _ = invoke(
            ["select", work["id"]], httpx.MockTransport(stale_response), tmp_path
        )
        assert code == 1
        assert error["code"] == "invalid-response"
        assert error["details"]["writeOutcome"] == "unknown"
    store.close()


def test_cli_rejects_stale_outline_save(tmp_path: Path) -> None:
    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    app = create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store)
    api = TestClient(app)
    work = api.post("/api/works", json={"seed": SEED}).json()
    api.post(f"/api/works/{work['id']}/advance")
    creative = store.get_work(work["id"]).artifacts[-1]
    api.post(
        f"/api/works/{work['id']}/artifacts/creative/select",
        json={"directionId": creative.content.directions[0].directionId, "expectedHeadVersion": 1},
    )
    api.post(f"/api/works/{work['id']}/advance")
    outline = store.get_work(work["id"]).artifacts[-1]
    path = request_file(tmp_path, "outline.json", outline.content.model_dump())
    changed_content = outline.content.model_dump()
    changed_content["arcs"][0]["title"] = "另一份大纲"
    candidates = [
        outline,
        outline.model_copy(
            update={"id": "outline-forged", "version": 2, "content": changed_content}
        ),
    ]

    for candidate in candidates:

        def stale_response(request: httpx.Request, candidate: Any = candidate) -> httpx.Response:
            if request.url.path.endswith("/artifacts/outline"):
                return httpx.Response(200, json=candidate.model_dump(mode="json"), request=request)
            return api.request(
                request.method, str(request.url), content=request.content, headers=request.headers
            )

        code, error, _, _ = invoke(
            ["save-outline", work["id"], "--file", path],
            httpx.MockTransport(stale_response),
            tmp_path,
        )
        assert code == 1
        assert error["code"] == "invalid-response"
        assert error["details"]["writeOutcome"] == "unknown"
    store.close()


def test_cli_rejects_create_response_with_unbound_title(tmp_path: Path) -> None:
    calls = []

    def wrong_title(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "id": "work-1",
                "title": "另一部作品的标题",
                "seed": SEED,
                "config": {},
                "createdAt": "2026-01-01T00:00:00.000Z",
            },
            request=request,
        )

    code, error, _, _ = invoke(
        ["create", "--seed", SEED], httpx.MockTransport(wrong_title), tmp_path
    )
    assert code == 1
    assert error["code"] == "invalid-response"
    assert error["details"]["writeOutcome"] == "unknown"
    assert len(calls) == 1


@pytest.mark.parametrize("kind", ["beat", "prose"])
def test_review_cli_rejects_wrong_kind_without_reposting(kind: str, tmp_path: Path) -> None:
    baseline = artifact(kind, BEAT if kind == "beat" else PROSE)
    wrong = artifact(
        "prose" if kind == "beat" else "beat", PROSE if kind == "beat" else BEAT
    ).model_copy(update={"id": baseline.id, "humanStatus": "approved"})
    response = successful_beat(artifact("beat", BEAT))
    response["body"]["artifact"] = wrong.model_dump(mode="json")
    response["body"]["command"]["operation"] = f"approve-{kind}"
    response["body"]["command"]["target"]["kind"] = kind
    response["body"]["command"]["expectedHead"]["artifactId"] = baseline.id
    response["body"]["command"]["resultHead"]["artifactId"] = baseline.id
    response["body"]["workflow"]["workflowState"] = f"{kind}-approved"
    posts = 0

    def wrong_kind(request: httpx.Request) -> httpx.Response:
        nonlocal posts
        if request.method == "POST":
            posts += 1
            return httpx.Response(200, json=response["body"], request=request)
        return httpx.Response(200, json=view(baseline).model_dump(mode="json"), request=request)

    path = request_file(
        tmp_path,
        f"approve-{kind}.json",
        {
            "chapter": 1,
            "expectedArtifactId": baseline.id,
            "expectedHeadVersion": 1,
            "content": baseline.content.model_dump(),
        },
    )
    code, error, _, _ = invoke(
        [f"approve-{kind}", baseline.workId, "--file", path],
        httpx.MockTransport(wrong_kind),
        tmp_path,
    )
    assert code == 1
    assert error["code"] == f"{kind}-result-unknown"
    assert error["details"]["causeCode"] == "invalid-response"
    assert error["details"]["hasUnknownWrite"] is True
    assert posts == 1


def test_safe_integer_covers_configuration_and_internal_preconditions(tmp_path: Path) -> None:
    assert AgentConfig(configRevision=MAX_SAFE).configRevision == MAX_SAFE
    with pytest.raises(ValidationError):
        AgentConfig(configRevision=MAX_SAFE + 1)
    with pytest.raises(ValidationError):
        ArtifactHead(artifactId="artifact", version=MAX_SAFE + 1, humanStatus="pending")
    with pytest.raises(ValidationError):
        ArtifactPrecondition(kind="beat", chapter=MAX_SAFE + 1, head=None)

    store = SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    api = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    work = api.post("/api/works", json={"seed": SEED}).json()
    value = api.get(f"/api/works/{work['id']}/agent-config").json()
    value["revision"] = MAX_SAFE
    AuthorConfigView.model_validate(value)
    value["revision"] = MAX_SAFE + 1
    with pytest.raises(ValidationError):
        AuthorConfigView.model_validate(value)
    store.close()


@pytest.mark.parametrize(
    ("model", "operation"),
    [(BeatCommandErrorBody, "approve-beat"), (ProseCommandErrorBody, "approve-prose")],
)
def test_safe_integer_covers_command_issue_count(model: Any, operation: str) -> None:
    body = {
        "code": "invalid-input",
        "message": "invalid",
        "retryable": False,
        "issueCount": MAX_SAFE,
        "command": {
            "kind": "request-rejected",
            "requestId": REQUEST_ID,
            "operation": operation,
            "executionMode": "demo",
            "latencyMs": 1,
            "attemptIds": [],
        },
    }
    model.model_validate(body)
    with pytest.raises(ValidationError):
        model.model_validate({**body, "issueCount": MAX_SAFE + 1})


@pytest.mark.parametrize("count", [MAX_SAFE, MAX_SAFE + 1])
def test_cli_validates_generic_error_issue_count(count: int, tmp_path: Path) -> None:
    def error_response(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={
                "code": "invalid-input",
                "message": "invalid",
                "retryable": False,
                "issueCount": count,
            },
            request=request,
        )

    code, error, _, _ = invoke(["advance", "work"], httpx.MockTransport(error_response), tmp_path)
    assert code == 1
    assert error["code"] == ("invalid-response" if count > MAX_SAFE else "invalid-input")
    if count > MAX_SAFE:
        assert error["details"]["writeOutcome"] == "unknown"


def test_cli_accepts_valid_work_list_above_two_mib(tmp_path: Path) -> None:
    works = [
        {"id": f"work-{index}", "title": "作品", "seedPreview": "脑洞", "chapterCount": 0}
        for index in range(40_000)
    ]

    def large_response(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=works, request=request)

    code, result, _, _ = invoke(["list"], httpx.MockTransport(large_response), tmp_path)
    assert code == 0
    assert len(result) == 40_000


def test_cli_rejects_stale_generic_approval(tmp_path: Path) -> None:
    posts = 0

    def stale_response(request: httpx.Request) -> httpx.Response:
        nonlocal posts
        posts += 1
        return httpx.Response(
            200,
            json={
                "workId": "work",
                "stage": "awaiting-approval",
                "nextStepId": None,
                "pendingGate": {"kind": "outline"},
            },
            request=request,
        )

    code, error, _, _ = invoke(
        ["approve", "work", "outline"], httpx.MockTransport(stale_response), tmp_path
    )
    assert code == 1
    assert error["code"] == "invalid-response"
    assert error["details"]["writeOutcome"] == "unknown"
    assert posts == 1


@pytest.mark.parametrize("backend", ["memory", "sqlite"])
def test_seed_batch_failure_does_not_leave_partial_works(
    backend: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = InMemoryStore() if backend == "memory" else SqliteStore(tmp_path / "agent4novel.sqlite")
    target = (
        "agent4novel.store.memory._new_work"
        if backend == "memory"
        else "agent4novel.store.work._new_work"
    )
    original = __import__("agent4novel.store.work", fromlist=["_new_work"])._new_work
    calls = 0

    def fail_second(seed: str, title: str | None = None) -> Any:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("synthetic seed failure")
        return original(seed, title)

    monkeypatch.setattr(target, fail_second)
    with pytest.raises(RuntimeError, match="synthetic seed failure"):
        store.create_works_if_empty(DEMO_WORKS)
    assert store.list_works() == []
    if isinstance(store, SqliteStore):
        assert store.db.in_transaction is False
    store.close()


@pytest.mark.parametrize(
    ("kind", "wrong_next", "expected_next"),
    [("caption", "caption", "creative"), ("outline", "caption", "setting")],
)
def test_cli_generic_approval_binds_the_next_step(
    kind: str, wrong_next: str, expected_next: str, tmp_path: Path
) -> None:
    state = {"workId": "work", "stage": "ready", "nextStepId": wrong_next}
    posts = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal posts
        posts += 1
        return httpx.Response(200, json=state, request=request)

    transport = httpx.MockTransport(respond)
    code, error, _, _ = invoke(["approve", "work", kind], transport, tmp_path)
    assert code == 1
    assert error["code"] == "invalid-response"
    assert error["details"]["writeOutcome"] == "unknown"
    assert posts == 1

    state["nextStepId"] = expected_next
    code, result, _, _ = invoke(["approve", "work", kind], transport, tmp_path)
    assert code == 0
    assert result["nextStepId"] == expected_next
    assert posts == 2


def test_cli_stops_an_oversized_success_response_before_json_parsing(tmp_path: Path) -> None:
    budget = 64 * 1024 * 1024
    total = budget + 2
    seen = 0

    def oversized(request: httpx.Request) -> httpx.Response:
        class Content(httpx.SyncByteStream):
            def __iter__(self):
                nonlocal seen
                seen += 1
                yield b"["
                for _ in range(budget // 65_536):
                    seen += 65_536
                    yield b" " * 65_536
                seen += 1
                yield b"]"

        return httpx.Response(200, stream=Content(), request=request)

    code, error, _, _ = invoke(["advance", "work"], httpx.MockTransport(oversized), tmp_path)
    assert code == 1
    assert error["code"] == "invalid-response"
    assert error["details"]["writeOutcome"] == "unknown"
    assert seen < total
