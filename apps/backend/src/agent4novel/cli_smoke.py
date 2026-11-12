from collections.abc import Callable
from typing import Any

from .cli_http import CliError, HttpClient, _path
from .cli_special import approve_setting, run_review_command
from .contracts import AppConfigResponse
from .domain.outcomes import AdvanceOutcomeDto
from .domain.requests import (
    ApproveRequest,
    BeatApproveRequest,
    ProseApproveRequest,
    ProseSaveRequest,
    SelectCreativeRequest,
    SettingApproveRequest,
    WorkCreateRequest,
)
from .domain.work import Artifact, PipelineState, Work
from .services.submissions import (
    matches_beat_submission,
    matches_prose_submission,
    matches_setting_submission,
)


def run_smoke(
    client: HttpClient,
    seed: str,
    title: str | None,
    log: Callable[[str], None],
) -> dict[str, Any]:
    steps: list[dict[str, Any]] = []
    mode = "unknown"
    work_id: str | None = None

    def run(step: str, operation: Callable[[], Any], detail: Callable[[Any], str]) -> Any:
        log(f"[smoke] {step} ...")
        try:
            value = operation()
        except CliError as error:
            steps.append({"step": step, "ok": False, "detail": error.code})
            raise CliError(
                error.code,
                error.message,
                status=error.status,
                retryable=error.retryable,
                details={
                    **(error.details or {}),
                    "workId": work_id,
                    "executionMode": mode,
                    "steps": steps,
                },
                issues=error.issues,
                attempt_id=error.attemptId,
            ) from error
        except Exception as error:
            steps.append({"step": step, "ok": False, "detail": "smoke-failed"})
            raise CliError(
                "smoke-failed",
                "Smoke operation failed",
                details={"workId": work_id, "executionMode": mode, "steps": steps},
            ) from error
        result = detail(value)
        steps.append({"step": step, "ok": True, "detail": result})
        log(f"[smoke] {step}: {result}")
        return value

    configuration = run(
        "config",
        lambda: AppConfigResponse.model_validate(
            client.validate(client.request("GET", "/api/config"), AppConfigResponse)
        ),
        lambda value: "demo" if value.demo else "live",
    )
    mode = "demo" if configuration.demo else "live"
    created = run(
        "create",
        lambda: Work.model_validate(
            client.validate(
                client.request(
                    "POST",
                    "/api/works",
                    WorkCreateRequest(seed=seed, **({"title": title} if title is not None else {})),
                ),
                Work,
                write=True,
                matches=lambda value: value.seed == seed,
            )
        ),
        lambda value: value.id,
    )
    work_id = created.id

    def advance() -> Any:
        outcome = client.validate(
            client.request("POST", _path(work_id, "/advance"), timeout_ms=1_820_000),
            AdvanceOutcomeDto,
            write=True,
            matches=lambda result: result.state.workId == work_id,
        )
        if outcome["kind"] == "failed":
            command = outcome.get("proseCommand") or outcome.get("beatCommand")
            raise CliError(
                outcome["code"],
                f"Smoke stopped at {outcome['stepId']}",
                status=200,
                retryable=outcome["retryable"],
                details={
                    "telemetry": outcome["telemetry"],
                    **({"command": command} if command is not None else {}),
                    **(
                        {"inputBudget": outcome["inputBudget"]}
                        if outcome.get("inputBudget") is not None
                        else {}
                    ),
                },
                attempt_id=outcome.get("attemptId"),
            )
        return outcome

    run("advance#1(caption+creative)", advance, lambda value: value["kind"])
    creative = client.artifact(work_id, "creative")
    selected = run(
        "select(first direction)",
        lambda: Artifact.model_validate(
            client.validate(
                client.request(
                    "POST",
                    _path(work_id, "/artifacts/creative/select"),
                    SelectCreativeRequest(
                        directionId=creative.content.directions[0].directionId,
                        expectedHeadVersion=creative.version,
                    ),
                ),
                Artifact,
                write=True,
                matches=lambda value: (
                    value.workId == work_id
                    and value.kind == "creative"
                    and value.humanStatus == "approved"
                ),
            )
        ),
        lambda value: f"v{value.version} {value.humanStatus}",
    )
    assert selected.kind == "creative"
    run("advance#2(outline)", advance, lambda value: value["kind"])
    run(
        "approve(outline)",
        lambda: PipelineState.model_validate(
            client.validate(
                client.request("POST", _path(work_id, "/approve"), ApproveRequest(kind="outline")),
                PipelineState,
                write=True,
                matches=lambda value: value.workId == work_id,
            )
        ),
        lambda value: value.stage,
    )
    run("advance#3(setting)", advance, lambda value: value["kind"])
    setting = run(
        "get(setting)",
        lambda: client.artifact(work_id, "setting"),
        lambda value: f"v{value.version} {value.humanStatus}",
    )
    if setting.humanStatus != "pending":
        raise CliError("smoke-incomplete", "Smoke requires a pending setting before review")
    setting_request = SettingApproveRequest.model_validate(
        {
            "expectedHeadVersion": setting.version,
            "content": {
                **setting.content.model_dump(),
                "overview": setting.content.overview + "\n\n作者确认：这是本次 smoke 的设定定稿。",
            },
        }
    )
    run(
        "approve-setting(edited)",
        lambda: approve_setting(client, work_id, setting_request),
        lambda value: f"v{value['version']} approved",
    )
    run("advance#4(beat)", advance, lambda value: value["kind"])
    beat = run(
        "get(beat#1)",
        lambda: client.artifact(work_id, "beat", 1),
        lambda value: f"v{value.version} {value.humanStatus}",
    )
    if beat.humanStatus != "pending":
        raise CliError("smoke-incomplete", "Smoke requires pending Beat review")
    beat_request = BeatApproveRequest.model_validate(
        {
            "chapter": 1,
            "expectedArtifactId": beat.id,
            "expectedHeadVersion": beat.version,
            "content": {
                **beat.content.model_dump(),
                "goal": beat.content.goal + "\n\n作者确认：先保护证人，再追问线索。",
            },
        }
    )
    run(
        "approve-beat(edited)",
        lambda: run_review_command(client, "beat", "approve-beat", work_id, beat_request),
        lambda value: "approved",
    )
    run("advance#5(prose)", advance, lambda value: value["kind"])
    prose = run(
        "get(prose#1)",
        lambda: client.artifact(work_id, "prose", 1),
        lambda value: f"v{value.version} {value.humanStatus}",
    )
    if prose.humanStatus != "pending":
        raise CliError("smoke-incomplete", "Smoke requires pending first-chapter Prose review")
    text = prose.content.text + "\n\n作者定稿：先保护证人，再追问线索。\n"
    save_request = ProseSaveRequest.model_validate(
        {
            "chapter": 1,
            "expectedArtifactId": prose.id,
            "expectedHeadVersion": prose.version,
            "expectedHumanStatus": "pending",
            "content": {"text": text},
        }
    )
    saved = run(
        "save-prose(edited)",
        lambda: run_review_command(client, "prose", "save-prose", work_id, save_request),
        lambda value: f"v{value['artifact']['version']} pending",
    )
    saved_artifact = Artifact.model_validate(saved["artifact"])
    prose_request = ProseApproveRequest.model_validate(
        {
            "chapter": 1,
            "expectedArtifactId": saved_artifact.id,
            "expectedHeadVersion": saved_artifact.version,
            "content": {"text": text},
        }
    )
    run(
        "approve-prose(saved)",
        lambda: run_review_command(client, "prose", "approve-prose", work_id, prose_request),
        lambda value: "approved",
    )

    def final() -> Work:
        current = client.work(work_id)
        if current.workflowState != "prose-approved" or any(
            (artifact.chapter or 0) > 1 for artifact in current.artifacts
        ):
            raise CliError("smoke-incomplete", "Smoke did not finish only the first chapter")
        current_setting = next(item for item in current.artifacts if item.kind == "setting")
        current_beat = next(item for item in current.artifacts if item.kind == "beat")
        current_prose = next(item for item in current.artifacts if item.kind == "prose")
        if (
            not matches_setting_submission(setting, setting_request, current_setting)
            or not matches_beat_submission(beat, beat_request, current_beat)
            or not matches_prose_submission(saved_artifact, prose_request, current_prose)
        ):
            raise CliError("smoke-incomplete", "Smoke did not confirm the edited first chapter")
        return current

    completed = run("get(final)", final, lambda value: value.workflowState)
    return {
        "workId": work_id,
        "executionMode": mode,
        "steps": steps,
        "final": completed.model_dump(mode="json"),
    }
