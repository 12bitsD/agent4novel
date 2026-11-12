import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from nextloop import ModelResponse, ModelUsage, ProviderError
from resource_fixtures import SKILL_ID, WORK_ID, populate_resources
from work_fixtures import CAPTION, CREATIVE, SEED

from agent4novel.agent.runtime import ModelRuntime
from agent4novel.main import create_app
from agent4novel.services.author_config import AuthorConfigService
from agent4novel.store.work import SqliteStore


class QueueProvider:
    def __init__(self, responses: list[ModelResponse | Exception], on_request: Any = None) -> None:
        self.responses = responses
        self.requests: list[Any] = []
        self.on_request = on_request

    async def complete(self, request: Any, *, attempt: int, cancel: Any) -> ModelResponse:
        index = len(self.requests)
        self.requests.append(request)
        if self.on_request is not None:
            self.on_request(index)
        response = self.responses[index]
        if isinstance(response, Exception):
            raise response
        return response


def response(content: dict[str, Any]) -> ModelResponse:
    return ModelResponse(
        content=json.dumps(content, ensure_ascii=False),
        usage=ModelUsage(input_tokens=20, output_tokens=8),
    )


def creative_content() -> dict[str, Any]:
    direction = CREATIVE["directions"][0]
    pack = {key: value for key, value in direction.items() if key != "directionId"}
    return {"directions": [pack, pack]}


def live_client(
    tmp_path: Path, provider: QueueProvider
) -> tuple[SqliteStore, TestClient, ModelRuntime]:
    env = {"A4N_DATA_DIR": str(tmp_path), "KIMI_API_KEY": "synthetic"}
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    runtime = ModelRuntime(env, provider_factory=lambda **kwargs: provider)
    client = TestClient(create_app(env, root=tmp_path, store=store, runtime=runtime))
    return store, client, runtime


def test_demo_create_advance_save_and_select(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    client = TestClient(create_app({"A4N_DATA_DIR": str(tmp_path)}, root=tmp_path, store=store))
    created = client.post("/api/works", json={"seed": SEED, "title": "  "})
    assert created.status_code == 201, created.text
    work = created.json()
    assert work["config"] == {}
    assert work["title"]

    advanced = client.post(f"/api/works/{work['id']}/advance")
    assert advanced.status_code == 200, advanced.text
    outcome = advanced.json()
    assert outcome["kind"] == "advanced"
    assert outcome["stepId"] == "creative"
    assert outcome["state"]["stage"] == "awaiting-approval"
    assert outcome["telemetry"] == []
    stored = store.get_work(work["id"])
    assert stored is not None
    assert [(item.kind, item.humanStatus) for item in stored.artifacts] == [
        ("caption", "approved"),
        ("creative", "pending"),
    ]
    creative = stored.artifacts[1]
    assert len(creative.content.directions) == 2
    content = creative.content.model_dump()
    content["directions"][0]["title"] = "作者修改后的方向"
    saved = client.put(
        f"/api/works/{work['id']}/artifacts/creative",
        json={"expectedHeadVersion": 1, "content": content},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == 2
    assert saved.json()["humanStatus"] == "pending"
    selected = client.post(
        f"/api/works/{work['id']}/artifacts/creative/select",
        json={"directionId": content["directions"][0]["directionId"], "expectedHeadVersion": 2},
    )
    assert selected.status_code == 200, selected.text
    assert selected.json()["version"] == 3
    assert selected.json()["humanStatus"] == "approved"
    assert len(selected.json()["content"]["directions"]) == 1
    view = client.get(f"/api/works/{work['id']}").json()
    assert view["workflowState"] == "ready-to-generate"
    assert view["nextStepId"] == "outline"
    store.close()


def test_live_advance_regenerate_and_request_telemetry(tmp_path: Path) -> None:
    provider = QueueProvider(
        [response(CAPTION), response(creative_content()), response(creative_content())]
    )
    store, client, runtime = live_client(tmp_path, provider)
    work = client.post("/api/works", json={"seed": SEED}).json()

    advanced = client.post(f"/api/works/{work['id']}/advance")
    assert advanced.status_code == 200, advanced.text
    outcome = advanced.json()
    assert outcome["kind"] == "advanced"
    assert len(outcome["telemetry"]) == 2
    assert {entry["stepId"] for entry in outcome["telemetry"]} == {"caption", "creative"}
    assert len({entry["requestId"] for entry in outcome["telemetry"]}) == 1
    stored = store.get_work(work["id"])
    assert stored is not None
    creative = stored.artifacts[1]
    assert creative.inputs[0].artifactId == stored.artifacts[0].id

    repeated = client.post(f"/api/works/{work['id']}/advance")
    assert repeated.json()["kind"] == "awaiting-approval"
    assert repeated.json()["telemetry"] == []
    regenerated = client.post(
        f"/api/works/{work['id']}/artifacts/creative/regenerate",
        json={
            "expectedArtifactId": creative.id,
            "expectedHeadVersion": creative.version,
            "instructions": "强化主角主动选择",
        },
    )
    assert regenerated.status_code == 200, regenerated.text
    assert regenerated.json()["version"] == 2
    assert "强化主角主动选择" in provider.requests[-1].messages[1].content
    diagnostics = client.get(f"/api/works/{work['id']}/telemetry").json()
    assert len(diagnostics["telemetry"]) == 3
    assert diagnostics["window"]["llm"]["latestSeq"] == 3
    assert runtime.mode == "live"
    store.close()


def test_model_failure_does_not_write_and_exposes_safe_state(tmp_path: Path) -> None:
    provider = QueueProvider([ProviderError("PRIVATE_PROVIDER_TEXT", retryable=False)])
    store, client, _ = live_client(tmp_path, provider)
    work = client.post("/api/works", json={"seed": SEED}).json()

    failed = client.post(f"/api/works/{work['id']}/advance")
    assert failed.status_code == 200, failed.text
    outcome = failed.json()
    assert outcome["kind"] == "failed"
    assert outcome["stepId"] == "caption"
    assert outcome["code"] == "llm-unavailable"
    assert outcome["retryable"] is False
    assert "PRIVATE_PROVIDER_TEXT" not in failed.text
    stored = store.get_work(work["id"])
    assert stored is not None and stored.artifacts == []
    view = client.get(f"/api/works/{work['id']}").json()
    assert view["workflowState"] == "failed"
    assert view["allowedActions"] == []
    store.close()


def test_commit_rejects_caption_changed_during_generation(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "agent4novel.sqlite")
    work = store.create_work(SEED)
    store.append_artifact(work.id, "caption", CAPTION, human_status="approved")

    def replace_caption(_: int) -> None:
        store.append_artifact(work.id, "caption", CAPTION, human_status="approved")

    provider = QueueProvider([response(creative_content())], on_request=replace_caption)
    env = {"A4N_DATA_DIR": str(tmp_path), "KIMI_API_KEY": "synthetic"}
    runtime = ModelRuntime(env, provider_factory=lambda **kwargs: provider)
    client = TestClient(create_app(env, root=tmp_path, store=store, runtime=runtime))

    outcome = client.post(f"/api/works/{work.id}/advance")
    assert outcome.status_code == 200, outcome.text
    assert outcome.json()["kind"] == "failed"
    assert outcome.json()["stepId"] == "creative"
    assert outcome.json()["code"] == "upstream-changed"
    assert outcome.json()["retryable"] is True
    stored = store.get_work(work.id)
    assert stored is not None
    assert [item.kind for item in stored.artifacts] == ["caption"]
    assert stored.artifacts[0].version == 2
    store.close()


def test_invalid_requests_keep_public_error_contract(tmp_path: Path) -> None:
    client = TestClient(create_app({}))
    missing_seed = client.post("/api/works", json={"title": "无素材"})
    assert missing_seed.status_code == 400
    assert missing_seed.json()["code"] == "invalid-input"
    assert missing_seed.json()["issues"][0]["path"] == ["seed"]
    malformed = client.post("/api/works", content="{", headers={"content-type": "application/json"})
    assert malformed.status_code == 400
    assert malformed.json() == {
        "code": "bad-json",
        "message": "invalid json body",
        "retryable": False,
    }
    missing = client.post("/api/works/missing/advance")
    assert missing.status_code == 404
    assert missing.json()["code"] == "work-not-found"


def test_author_snapshot_contains_effective_guidance_and_file_provenance(tmp_path: Path) -> None:
    store, data_dir = populate_resources(tmp_path / "agent4novel.sqlite")
    work = store.get_work(WORK_ID)
    assert work is not None
    configs = AuthorConfigService(store, {"KIMI_API_KEY": "synthetic"}, data_dir).snapshot(work)
    assert configs["caption"].directionCount == 1
    assert configs["caption"].systemPrompt == ""
    assert "Author preferences:" not in configs["caption"].systemPrompt
    assert '"genre":"都市"' in configs["creative"].systemPrompt
    assert "Use concrete actions." in configs["prose"].systemPrompt
    assert configs["prose"].configFiles[0].id == SKILL_ID
    assert configs["prose"].configRevision == 1
    store.close()
