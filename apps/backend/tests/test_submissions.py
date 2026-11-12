from work_fixtures import BEAT, PROSE, SETTING

from agent4novel.domain.commands import BeatCommandErrorBody, BeatCommandResponse
from agent4novel.domain.requests import (
    BeatApproveRequest,
    ProseApproveRequest,
    ProseSaveRequest,
    SettingApproveRequest,
)
from agent4novel.domain.work import AgentConfig, Artifact, WorkView
from agent4novel.services.review_content import assign_beat_ids, assign_setting_ids
from agent4novel.services.submissions import (
    matches_beat_submission,
    matches_prose_save,
    matches_prose_submission,
    matches_setting_submission,
    recover_submission,
)


def artifact(kind: str, content: dict, status: str = "pending") -> Artifact:
    return Artifact.model_validate(
        {
            "id": f"artifact-{kind}",
            "workId": "work-1",
            "kind": kind,
            **({"chapter": 1} if kind in {"beat", "prose"} else {}),
            "version": 1,
            "content": content,
            "humanStatus": status,
            "createdAt": "2026-01-01T00:00:00.000Z",
        }
    )


def view(*artifacts: Artifact, state: str = "awaiting-beat-review") -> WorkView:
    return WorkView(
        id="work-1",
        title="合成",
        seed="合成",
        config=AgentConfig(),
        createdAt="2026-01-01T00:00:00.000Z",
        artifacts=list(artifacts),
        workflowState=state,
        allowedActions=["approve"],
        nextStepId=None,
    )


def beat_submission(content: dict = BEAT) -> BeatApproveRequest:
    return BeatApproveRequest.model_validate(
        {
            "chapter": 1,
            "expectedArtifactId": "artifact-beat",
            "expectedHeadVersion": 1,
            "content": content,
        }
    )


def test_setting_match_protects_existing_and_new_identities() -> None:
    baseline = artifact("setting", SETTING)
    request = SettingApproveRequest.model_validate(
        {
            "expectedHeadVersion": 1,
            "content": {
                **SETTING,
                "world": [
                    SETTING["world"][0],
                    {"title": "新规则", "content": "只能在夜间生效"},
                ],
            },
        }
    )
    candidate = baseline.model_copy(
        update={
            "humanStatus": "approved",
            "content": assign_setting_ids(request.content, baseline.content),
        }
    )
    assert matches_setting_submission(baseline, request, candidate)
    reused = candidate.model_copy()
    reused.content.world[1].itemId = SETTING["world"][0]["itemId"]
    assert not matches_setting_submission(baseline, request, reused)


def test_beat_match_requires_existing_or_new_card_id() -> None:
    baseline = artifact("beat", BEAT)
    missing = {**BEAT, "writingPlan": [{"title": "新行动", "content": "保护证人"}]}
    request = beat_submission(missing)
    candidate = baseline.model_copy(
        update={
            "humanStatus": "approved",
            "content": assign_beat_ids(request.content, baseline.content),
        }
    )
    assert matches_beat_submission(baseline, request, candidate)
    reused = candidate.model_copy()
    reused.content.writingPlan[0].itemId = "plan-1"
    assert not matches_beat_submission(baseline, request, reused)
    foreign = beat_submission(
        {
            **missing,
            "writingPlan": [{"itemId": "foreign", "title": "新行动", "content": "保护证人"}],
        }
    )
    assert not matches_beat_submission(baseline, foreign, candidate)


def test_prose_save_requires_exact_text_status_and_new_identity() -> None:
    baseline = artifact("prose", PROSE)
    request = ProseSaveRequest.model_validate(
        {
            "chapter": 1,
            "expectedArtifactId": baseline.id,
            "expectedHeadVersion": 1,
            "expectedHumanStatus": "pending",
            "content": {"text": "作者修改后的全文😀"},
        }
    )
    candidate = baseline.model_copy(
        update={"id": "artifact-prose-2", "version": 2, "content": request.content}
    )
    assert matches_prose_save(baseline, request, candidate)
    changed = candidate.model_copy(update={"content": {"text": "另一份全文"}})
    assert not matches_prose_save(baseline, request, changed)
    approval = ProseApproveRequest.model_validate(
        {
            "chapter": 1,
            "expectedArtifactId": baseline.id,
            "expectedHeadVersion": 1,
            "content": PROSE,
        }
    )
    approved = Artifact.model_validate({**baseline.model_dump(), "humanStatus": "approved"})
    assert matches_prose_submission(baseline, approval, approved)


def successful_beat(baseline: Artifact) -> dict:
    approved = baseline.model_copy(update={"humanStatus": "approved"})
    return {
        "status": 200,
        "body": BeatCommandResponse(
            artifact=approved,
            command={
                "kind": "execution-result",
                "requestId": "request-1",
                "operation": "approve-beat",
                "executionMode": "demo",
                "latencyMs": 1,
                "target": {"workId": baseline.workId, "kind": "beat", "chapter": 1},
                "expectedHead": {"artifactId": baseline.id, "version": 1},
                "writeOutcome": "committed",
                "resultHead": {"artifactId": baseline.id, "version": 1, "humanStatus": "approved"},
                "attemptIds": [],
            },
            workflow={
                "workflowState": "beat-approved",
                "nextStepId": "prose",
                "allowedActions": [],
            },
            telemetry=[],
        ).model_dump(mode="json"),
    }


def rejected_beat(baseline: Artifact, status: int = 409, operation: str = "approve-beat") -> dict:
    return {
        "status": status,
        "body": BeatCommandErrorBody(
            code="version-conflict",
            message="version-conflict",
            retryable=False,
            command={
                "kind": "execution-result",
                "requestId": "request-1",
                "operation": operation,
                "executionMode": "demo",
                "latencyMs": 1,
                "target": {"workId": baseline.workId, "kind": "beat", "chapter": 1},
                "expectedHead": {"artifactId": baseline.id, "version": 1},
                "writeOutcome": "not-committed",
                "failureStage": "commit",
                "attemptIds": [],
            },
        ).model_dump(mode="json"),
    }


def test_beat_recovery_confirms_success_and_proves_rejection() -> None:
    baseline = artifact("beat", BEAT)
    request = beat_submission()
    success = recover_submission(
        "beat", baseline, "approve-beat", request, False, successful_beat(baseline)
    )
    assert success.resolution == "confirmed"
    assert success.artifact.humanStatus == "approved"
    rejected = recover_submission(
        "beat",
        baseline,
        "approve-beat",
        request,
        False,
        rejected_beat(baseline),
        view(baseline).model_copy(update={"allowedActions": []}),
        True,
    )
    assert rejected.resolution == "rejected"
    assert rejected.hasUnknownWrite is False
    assert rejected.nextActions == ["read-work", "inspect-diagnostics"]
    mismatched = recover_submission(
        "beat",
        baseline,
        "approve-beat",
        request,
        False,
        rejected_beat(baseline, operation="regenerate-beat"),
    )
    assert mismatched.resolution == "uncertain"
    assert mismatched.hasUnknownWrite is True
    previous_unknown = recover_submission(
        "beat",
        baseline,
        "approve-beat",
        request,
        True,
        rejected_beat(baseline),
        view(baseline),
        True,
    )
    assert previous_unknown.resolution == "uncertain"
    assert previous_unknown.hasUnknownWrite is True


def test_recovery_readback_confirms_or_detects_conflict_without_reposting() -> None:
    baseline = artifact("beat", BEAT)
    request = beat_submission()
    approved = baseline.model_copy(update={"humanStatus": "approved"})
    recovered = recover_submission(
        "beat",
        baseline,
        "approve-beat",
        request,
        False,
        {"status": 500, "body": None},
        view(approved, state="beat-approved"),
        True,
    )
    assert recovered.resolution == "confirmed"
    assert recovered.artifact.id == baseline.id
    changed = baseline.model_copy(update={"id": "another", "version": 2})
    conflict = recover_submission(
        "beat",
        baseline,
        "approve-beat",
        request,
        False,
        {"status": 500, "body": None},
        view(changed),
        True,
    )
    assert conflict.resolution == "conflict"
    assert conflict.hasUnknownWrite is True
    unknown = recover_submission(
        "prose",
        artifact("prose", PROSE),
        "regenerate-prose",
        {
            "chapter": 1,
            "expectedArtifactId": "artifact-prose",
            "expectedHeadVersion": 1,
            "content": PROSE,
            "instructions": "重写",
        },
        False,
        {"status": 200, "body": {"kind": "not-a-command"}},
    )
    assert unknown.resolution == "uncertain"
    assert unknown.nextActions == ["read-work", "retry-frozen-request"]
