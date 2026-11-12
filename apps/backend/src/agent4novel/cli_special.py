import contextlib
from typing import Any, Literal

from pydantic import ValidationError

from .cli_http import CliError, HttpClient, _path
from .domain.commands import (
    BeatCommandErrorBody,
    BeatCommandResponse,
    BeatVariantSelectionResponse,
    ProseCommandErrorBody,
    ProseCommandResponse,
)
from .domain.requests import (
    BeatApproveRequest,
    BeatRegenerateRequest,
    BeatVariantSelectionRequest,
    ProseApproveRequest,
    ProseRegenerateRequest,
    ProseSaveRequest,
    SettingApproveRequest,
)
from .domain.work import Artifact, WorkView
from .services.submissions import (
    matches_setting_submission,
    recover_submission,
)

SPECIAL_COMMANDS = {
    "approve-setting",
    "approve-beat",
    "regenerate-beat",
    "select-beat-variant",
    "approve-prose",
    "regenerate-prose",
    "save-prose",
}


def approve_setting(client: HttpClient, work_id: str, value: Any) -> Any:
    request = SettingApproveRequest.model_validate(value)
    baseline = client.artifact(work_id, "setting")
    if baseline.humanStatus == "approved":
        raise CliError(
            "artifact-already-approved",
            "Setting is already approved; this invocation cannot confirm an earlier submission",
            status=409,
        )
    if baseline.version != request.expectedHeadVersion:
        raise CliError(
            "version-conflict",
            "The request file version does not match the current setting; "
            "it was not replaced or submitted",
            status=409,
        )
    failure: CliError | None = None
    try:
        candidate = client.validate(
            client.request("POST", _path(work_id, "/artifacts/setting/approve"), request),
            Artifact,
            write=True,
        )
        if not matches_setting_submission(baseline, request, candidate):
            raise CliError(
                "invalid-response", "Setting response does not match this submission", status=200
            )
        return candidate
    except CliError as error:
        failure = error
    rejected = (
        failure.status is not None
        and 400 <= failure.status < 500
        and failure.code != "invalid-response"
    )
    if rejected and failure.status != 409:
        raise failure
    latest: WorkView | None = None
    with contextlib.suppress(CliError):
        latest = client.work(work_id, reconcile=True)
    if latest is not None:
        candidate = next((item for item in latest.artifacts if item.kind == "setting"), None)
        if candidate is not None and matches_setting_submission(baseline, request, candidate):
            return candidate.model_dump(mode="json")
        if candidate is not None:
            raise CliError(
                "setting-conflict",
                "Setting was approved with different content; "
                "keep the request file and read the current setting",
                status=409,
            )
    if rejected:
        raise failure
    raise CliError(
        "setting-result-unknown",
        "Setting approval result is unknown; keep the request file and inspect the current setting",
        details={"writeOutcome": "unknown"},
    )


def _failure(
    kind: Literal["beat", "prose"], response: Any
) -> BeatCommandErrorBody | ProseCommandErrorBody | None:
    try:
        model = BeatCommandErrorBody if kind == "beat" else ProseCommandErrorBody
        return model.model_validate(response.get("body")) if response is not None else None
    except (ValidationError, TypeError, ValueError):
        return None


def run_review_command(
    client: HttpClient,
    kind: Literal["beat", "prose"],
    operation: str,
    work_id: str,
    value: Any,
) -> Any:
    if operation == "approve-beat":
        request: Any = BeatApproveRequest.model_validate(value)
    elif operation == "regenerate-beat":
        request = BeatRegenerateRequest.model_validate(value)
    elif operation == "approve-prose":
        request = ProseApproveRequest.model_validate(value)
    elif operation == "regenerate-prose":
        request = ProseRegenerateRequest.model_validate(value)
    else:
        request = ProseSaveRequest.model_validate(value)
    expected_head = {
        "artifactId": request.expectedArtifactId,
        "version": request.expectedHeadVersion,
        **({"humanStatus": request.expectedHumanStatus} if operation == "save-prose" else {}),
    }
    local = {
        "operation": operation,
        "target": {"workId": work_id, "kind": kind, "chapter": request.chapter},
        "expectedHead": expected_head,
    }
    try:
        baseline = client.artifact(work_id, kind, request.chapter)
    except CliError as error:
        if error.code == "artifact-not-found":
            error.details = {
                **local,
                "resolution": "rejected",
                "nextActions": ["read-work"],
                "observedHead": None,
            }
        raise
    expected_status = request.expectedHumanStatus if operation == "save-prose" else "pending"
    if (
        baseline.id != request.expectedArtifactId
        or baseline.version != request.expectedHeadVersion
        or baseline.humanStatus != expected_status
    ):
        raise CliError(
            "version-conflict",
            "Request identity, version or status no longer matches; "
            "the file was not modified or submitted",
            status=409,
            details={
                **local,
                "resolution": "conflict",
                "nextActions": ["read-work", "load-server-version"],
                "observedHead": {
                    "artifactId": baseline.id,
                    "version": baseline.version,
                    "humanStatus": baseline.humanStatus,
                },
            },
        )
    action = (
        "approve"
        if operation in {"approve-beat", "approve-prose"}
        else ("save" if operation == "save-prose" else "regenerate")
    )
    response = None
    cause_code = "network-error"
    try:
        response = client.request(
            "POST",
            _path(work_id, f"/artifacts/{kind}/{action}"),
            request,
            timeout_ms=920_000 if action == "regenerate" else 30_000,
            raw=True,
        )
    except CliError as error:
        cause_code = error.code
    initial = recover_submission(kind, baseline, operation, request, False, response=response)
    if initial.resolution == "confirmed" and response is not None:
        model = BeatCommandResponse if kind == "beat" else ProseCommandResponse
        return model.model_validate(response["body"]).model_dump(mode="json")
    failure = _failure(kind, response)
    if failure is not None:
        cause_code = failure.code
    elif response is not None:
        cause_code = "invalid-response"
    latest: WorkView | None = None
    try:
        latest = client.work(work_id, reconcile=True)
    except CliError as error:
        if error.code == "work-not-found":
            cause_code = error.code
    recovery = recover_submission(
        kind,
        baseline,
        operation,
        request,
        initial.hasUnknownWrite,
        response=response,
        work=latest,
        work_is_readback=latest is not None,
    )
    if recovery.resolution == "confirmed" and recovery.artifact is not None:
        return {
            "artifact": recovery.artifact.model_dump(mode="json"),
            "resolution": recovery.resolution,
            "nextActions": recovery.nextActions,
            "confirmedBy": "read-work",
        }
    code = (
        f"{kind}-result-conflict"
        if recovery.resolution == "conflict"
        else f"{kind}-result-unknown"
        if recovery.resolution == "uncertain"
        else cause_code
    )
    details = {
        **local,
        **recovery.model_dump(exclude={"artifact"}, exclude_none=True),
        "causeCode": cause_code,
    }
    if failure is not None:
        details.update(
            {
                key: value
                for key, value in {
                    "command": failure.command.model_dump(mode="json"),
                    "telemetry": failure.telemetry,
                    "inputBudget": failure.inputBudget,
                    "issueCount": failure.issueCount,
                    "issuesTruncated": failure.issuesTruncated,
                }.items()
                if value is not None
            }
        )
    raise CliError(
        code,
        f"{kind.capitalize()} command did not confirm the requested result; keep the request file",
        status=response.get("status") if response is not None else None,
        retryable=failure.retryable if failure is not None else False,
        details=details,
        issues=failure.issues if failure is not None else None,
        attempt_id=failure.attemptId if failure is not None else None,
    )


def _matches_variant(
    work_id: str, request: BeatVariantSelectionRequest, result: BeatVariantSelectionResponse
) -> bool:
    artifact = result.artifact
    selection = result.selection
    original = result.comparison.original
    candidate = result.comparison.candidate
    result_matches = (
        selection.writeOutcome == "not-committed" and artifact == candidate
        if request.choice == "new"
        else selection.writeOutcome == "committed"
        and artifact.workId == work_id
        and artifact.kind == "beat"
        and artifact.chapter == request.chapter
        and artifact.id not in {original.id, candidate.id}
        and artifact.version == candidate.version + 1
        and artifact.humanStatus == "pending"
        and artifact.content == original.content
    )
    return (
        result.choice == request.choice
        and selection.workId == work_id
        and selection.chapter == request.chapter
        and selection.choice == request.choice
        and selection.expectedHead.artifactId == request.expectedArtifactId
        and selection.expectedHead.version == request.expectedHeadVersion
        and selection.originalHead.artifactId == request.originalArtifactId
        and selection.originalHead.version == request.originalVersion
        and selection.resultHead.artifactId == artifact.id
        and selection.resultHead.version == artifact.version
        and selection.resultHead.humanStatus == artifact.humanStatus
        and original.workId == work_id
        and original.kind == "beat"
        and original.chapter == request.chapter
        and original.id == request.originalArtifactId
        and original.version == request.originalVersion
        and original.humanStatus == "pending"
        and candidate.workId == work_id
        and candidate.kind == "beat"
        and candidate.chapter == request.chapter
        and candidate.id == request.expectedArtifactId
        and candidate.version == request.expectedHeadVersion
        and candidate.humanStatus == "pending"
        and original.id != candidate.id
        and candidate.version == original.version + 1
        and original.content == request.originalContent
        and result_matches
    )


def select_beat_variant(client: HttpClient, work_id: str, value: Any) -> Any:
    request = BeatVariantSelectionRequest.model_validate(value)
    try:
        response = client.request(
            "POST",
            _path(work_id, "/artifacts/beat/select"),
            request,
            timeout_ms=30_000,
            raw=True,
        )
    except CliError as error:
        error.details = {**(error.details or {}), "writeOutcome": "unknown"}
        raise
    if 200 <= response["status"] < 300:
        return client.validate(
            response["body"],
            BeatVariantSelectionResponse,
            write=True,
            matches=lambda result: _matches_variant(work_id, request, result),
        )
    failure = client.error_body(response["body"], _path(work_id), True, None)
    unknown = response["status"] >= 500
    details = {key: failure[key] for key in ("issueCount", "issuesTruncated") if key in failure}
    if unknown:
        details["writeOutcome"] = "unknown"
    raise CliError(
        failure["code"],
        failure["message"],
        status=None if unknown else response["status"],
        retryable=failure["retryable"],
        details=details or None,
        issues=failure.get("issues"),
        attempt_id=failure.get("attemptId"),
    )


def execute_special_command(client: HttpClient, command: str, work_id: str, value: Any) -> Any:
    if command == "approve-setting":
        return approve_setting(client, work_id, value)
    if command in {"approve-beat", "regenerate-beat"}:
        return run_review_command(client, "beat", command, work_id, value)
    if command in {"approve-prose", "regenerate-prose", "save-prose"}:
        return run_review_command(client, "prose", command, work_id, value)
    if command == "select-beat-variant":
        return select_beat_variant(client, work_id, value)
    raise CliError("usage", "Unknown special command")
