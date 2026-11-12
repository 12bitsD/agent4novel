import hashlib
import json
from collections.abc import Callable, Mapping
from typing import Any, Literal
from urllib.parse import quote, urlencode

import httpx
from pydantic import BaseModel, TypeAdapter, ValidationError

from .contracts import AppConfigResponse
from .domain.commands import BeatCommandErrorBody, ProseCommandErrorBody
from .domain.diagnostics import DiagnosticQuery, DiagnosticResponse
from .domain.outcomes import AdvanceOutcomeDto
from .domain.requests import (
    ApproveRequest,
    CreativeRegenerateRequest,
    OutlineApprovalRequest,
    OutlineDraftRequest,
    SelectCreativeRequest,
    StartChapterRequest,
    WorkCreateRequest,
)
from .domain.resources import (
    AgentFile,
    AgentFileRead,
    AgentFileUpload,
    AuthorConfigReceipt,
    AuthorConfigSave,
    AuthorConfigView,
    BadExample,
    BadExamplePage,
    BadExampleRequest,
    matches_bad_example,
)
from .domain.work import Artifact, PipelineState, Work, WorkSummary, WorkView
from .errors import KnownError
from .services.review_content import normalize_outline_ids
from .services.validation import validation_metadata
from .text import utf16_slice


class CliError(KnownError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int | None = None,
        retryable: bool = False,
        details: Any = None,
        issues: list[Any] | None = None,
        attempt_id: str | None = None,
    ) -> None:
        super().__init__(code, message, retryable=retryable, attempt_id=attempt_id)
        self.status = status
        self.details = details
        self.issues = issues


def cli_error_json(error: CliError) -> str:
    return json.dumps(
        {
            "code": error.code,
            "message": error.message,
            "retryable": error.retryable,
            **({"status": error.status} if error.status is not None else {}),
            **({"attemptId": error.attemptId} if error.attemptId is not None else {}),
            **({"issues": error.issues} if error.issues is not None else {}),
            **({"details": error.details} if error.details is not None else {}),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


class Command:
    def __init__(
        self,
        minimum: int,
        maximum: int,
        *flags: str,
        required: tuple[str, ...] = (),
        exactly_one: tuple[str, str] | None = None,
    ) -> None:
        self.minimum = minimum
        self.maximum = maximum
        self.flags = frozenset(flags)
        self.required = frozenset(required)
        self.exactly_one = exactly_one


COMMANDS = {
    "list": Command(0, 0),
    "config": Command(0, 0),
    "create": Command(0, 0, "seed", "seed-file", "title", exactly_one=("seed", "seed-file")),
    "smoke": Command(0, 0, "seed", "seed-file", "title", exactly_one=("seed", "seed-file")),
    "get": Command(1, 1, "kind", "chapter"),
    "advance": Command(1, 1),
    "start-chapter": Command(1, 1, "file", required=("file",)),
    "select": Command(1, 2),
    "save-outline": Command(1, 1, "file", required=("file",)),
    "approve": Command(2, 2),
    "approve-outline": Command(1, 1, "file", required=("file",)),
    "regenerate-creative": Command(1, 1, "file", required=("file",)),
    "approve-setting": Command(1, 1, "file", required=("file",)),
    "approve-beat": Command(1, 1, "file", required=("file",)),
    "regenerate-beat": Command(1, 1, "file", required=("file",)),
    "select-beat-variant": Command(1, 1, "file", required=("file",)),
    "approve-prose": Command(1, 1, "file", required=("file",)),
    "regenerate-prose": Command(1, 1, "file", required=("file",)),
    "save-prose": Command(1, 1, "file", required=("file",)),
    "logs": Command(1, 1, "request-id", "attempt-id"),
    "agent-config": Command(1, 1),
    "save-agent-config": Command(1, 1, "file", required=("file",)),
    "upload-skill": Command(1, 1, "file", "request-id", required=("file", "request-id")),
    "upload-prompt": Command(1, 1, "file", "request-id", required=("file", "request-id")),
    "get-agent-file": Command(2, 2),
    "mark-bad-example": Command(1, 1, "file", required=("file",)),
    "bad-examples": Command(1, 1, "chapter", "after"),
    "bad-example": Command(2, 2),
}


def parse_cli_timeout(value: str) -> int:
    try:
        number = float(value.strip())
        if not number.is_integer() or not 1000 <= number <= 3_600_000:
            raise ValueError
        return int(number)
    except ValueError as cause:
        raise CliError(
            "usage", "CLI timeout must be an integer between 1000 and 3600000 milliseconds"
        ) from cause


def parse_command(
    arguments: list[str], env: Mapping[str, str]
) -> tuple[str, list[str], dict[str, str], int | None]:
    positional: list[str] = []
    flags: dict[str, str] = {}
    index = 0
    while index < len(arguments):
        token = arguments[index]
        index += 1
        if token == "--":
            continue
        if not token.startswith("-"):
            positional.append(token)
            continue
        if not token.startswith("--"):
            raise CliError("usage", "Unknown command option; use --help")
        key, separator, inline = token[2:].partition("=")
        if key in flags:
            raise CliError("usage", "Duplicate command option; use --help")
        if separator:
            value = inline
        elif index < len(arguments):
            value = arguments[index]
            index += 1
        else:
            raise CliError("usage", "Command option requires a non-empty value; use --help")
        if not value.strip() or (
            not separator
            and value.startswith("-")
            and not value.startswith(
                ("-.", "-0", "-1", "-2", "-3", "-4", "-5", "-6", "-7", "-8", "-9")
            )
        ):
            raise CliError("usage", "Command option requires a non-empty value; use --help")
        flags[key] = value
    if not positional or positional[0] not in COMMANDS:
        raise CliError("usage", "Unknown or missing command; use --help")
    command = positional[0]
    definition = COMMANDS[command]
    if any(key not in definition.flags | {"url", "timeout-ms"} for key in flags):
        raise CliError("usage", "Unknown command option; use --help")
    if not definition.minimum <= len(positional) - 1 <= definition.maximum:
        raise CliError("usage", "Invalid command arguments; use --help")
    if any(value.strip() == "" for value in positional[1:]):
        raise CliError("usage", "Invalid command arguments; use --help")
    if any(key not in flags for key in definition.required):
        raise CliError("usage", "Missing or mutually exclusive command inputs; use --help")
    if (
        definition.exactly_one is not None
        and sum(key in flags for key in definition.exactly_one) != 1
    ):
        raise CliError("usage", "Missing or mutually exclusive command inputs; use --help")
    timeout = flags.get("timeout-ms", env.get("A4N_CLI_TIMEOUT_MS"))
    return (
        command,
        positional[1:],
        flags,
        parse_cli_timeout(timeout) if timeout is not None else None,
    )


def _dump(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_dump(item) for item in value]
    if isinstance(value, dict):
        return {key: _dump(item) for key, item in value.items()}
    return value


def _path(work_id: str, suffix: str = "") -> str:
    return f"/api/works/{quote(work_id, safe='')}{suffix}"


def _safe_id(value: str) -> str:
    return quote(value, safe="")


def _matches_created_work(work: Work, request: WorkCreateRequest) -> bool:
    title = (
        request.title.strip()
        if request.title and request.title.strip()
        else utf16_slice(request.seed, 0, 20)
    )
    return work.seed == request.seed and work.title == title


def _matches_generic_approval(result: PipelineState, work_id: str, kind: str) -> bool:
    expected_next = {"caption": "creative", "outline": "setting"}.get(kind)
    if expected_next is None or result.workId != work_id or result.pendingGate is not None:
        return False
    if result.stage == "complete":
        return result.nextStepId is None
    return result.stage == "ready" and result.nextStepId == expected_next


def _integer(value: str, name: str) -> int:
    if not value.isascii() or not value.isdigit() or not 1 <= int(value) <= 9_007_199_254_740_991:
        raise CliError("invalid-input", f"{name} must be a positive safe integer")
    return int(value)


def _matches_start_chapter(response: Any, work_id: str, chapter: int) -> bool:
    if isinstance(response, BaseModel):
        response = response.model_dump()
    if not isinstance(response, dict):
        return False
    if "state" in response and (
        not isinstance(response["state"], dict) or response["state"].get("workId") != work_id
    ):
        return False
    if response.get("proseCommand") is not None:
        return False
    command = response.get("command") or response.get("beatCommand")
    if command is None:
        return True
    if not isinstance(command, dict) or command.get("operation") != "generate-beat":
        return False
    if command.get("kind") == "request-rejected":
        return True
    target = command.get("target")
    return (
        isinstance(target, dict)
        and target.get("workId") == work_id
        and target.get("kind") == "beat"
        and target.get("chapter") == chapter
    )


class HttpClient:
    def __init__(
        self,
        base_url: str,
        timeout_ms: int | None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_ms = timeout_ms
        self.client = httpx.Client(transport=transport)

    def close(self) -> None:
        self.client.close()

    @staticmethod
    def invalid_response(write: bool = False) -> CliError:
        return CliError(
            "invalid-response",
            "Invalid server response; inspect the work before retrying a write",
            details={"writeOutcome": "unknown"} if write else None,
        )

    def validate(
        self,
        data: Any,
        model: Any,
        *,
        write: bool = False,
        matches: Callable[[Any], bool] | None = None,
    ) -> Any:
        try:
            parsed = TypeAdapter(model).validate_python(data)
            if matches is not None and not matches(parsed):
                raise ValueError
            return TypeAdapter(model).dump_python(parsed, mode="json")
        except (ValidationError, TypeError, ValueError) as cause:
            raise self.invalid_response(write) from cause

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        timeout_ms: int = 300_000,
        raw: bool = False,
        matches_error: Callable[[dict[str, Any]], bool] | None = None,
    ) -> Any:
        write = method != "GET"
        try:
            with self.client.stream(
                method,
                f"{self.base_url}{path}",
                json=_dump(body) if body is not None else None,
                timeout=(self.timeout_ms or timeout_ms) / 1000,
            ) as response:
                limit = 65_536 if response.status_code >= 400 else 64 * 1024 * 1024
                content = bytearray()
                for chunk in response.iter_bytes():
                    if len(content) + len(chunk) > limit:
                        raise self.invalid_response(write)
                    content.extend(chunk)
                try:
                    data = json.loads(content)
                except (json.JSONDecodeError, UnicodeError) as cause:
                    raise self.invalid_response(write) from cause
        except CliError:
            raise
        except (httpx.HTTPError, ValueError) as cause:
            raise CliError(
                "network-error",
                "Request could not be completed; "
                "a submitted write may still complete on the server",
                details={"writeOutcome": "unknown"} if write else None,
            ) from cause
        if raw:
            return {"status": response.status_code, "body": data}
        if not 200 <= response.status_code < 300:
            error = self.error_body(data, path, write, matches_error)
            unknown = error.get("command", {}).get("writeOutcome") == "unknown"
            details = {
                key: error[key]
                for key in ("command", "telemetry", "inputBudget", "issueCount", "issuesTruncated")
                if key in error
            }
            if unknown:
                details["writeOutcome"] = "unknown"
            raise CliError(
                error["code"],
                error["message"],
                status=None if unknown else response.status_code,
                retryable=error["retryable"],
                details=details or None,
                issues=error.get("issues"),
                attempt_id=error.get("attemptId"),
            )
        return data

    def error_body(
        self,
        data: Any,
        path: str,
        write: bool,
        matches_error: Callable[[dict[str, Any]], bool] | None,
    ) -> dict[str, Any]:
        try:
            if not isinstance(data, dict):
                raise ValueError
            if set(data) - {
                "code",
                "message",
                "retryable",
                "attemptId",
                "issues",
                "issueCount",
                "issuesTruncated",
                "command",
                "telemetry",
                "inputBudget",
                "workflow",
            }:
                raise ValueError
            if (
                not isinstance(data.get("code"), str)
                or not data["code"]
                or not isinstance(data.get("message"), str)
                or not isinstance(data.get("retryable"), bool)
                or (matches_error is not None and not matches_error(data))
            ):
                raise ValueError
            issues = data.get("issues")
            if "issues" in data and (
                not isinstance(issues, list)
                or len(issues) > 128
                or any(
                    not isinstance(issue, dict)
                    or not isinstance(issue.get("path"), list)
                    or any(
                        not isinstance(part, (str, int)) or isinstance(part, bool)
                        for part in issue["path"]
                    )
                    or not isinstance(issue.get("code"), str)
                    or not isinstance(issue.get("message"), str)
                    for issue in issues
                )
            ):
                raise ValueError
            issue_count = data.get("issueCount")
            if issue_count is not None and (
                not isinstance(issue_count, int)
                or isinstance(issue_count, bool)
                or not 0 <= issue_count <= 9_007_199_254_740_991
                or issue_count < len(issues or [])
            ):
                raise ValueError
            if "issuesTruncated" in data and not isinstance(data["issuesTruncated"], bool):
                raise ValueError
            command = data.get("command")
            if command is not None:
                kind = command.get("target", {}).get("kind")
                error_model = BeatCommandErrorBody if kind == "beat" else ProseCommandErrorBody
                parsed = error_model.model_validate(data)
                work_id = path.split("/")[3]
                if parsed.command.kind == "execution-result" and (
                    parsed.command.target.workId != work_id
                ):
                    raise ValueError
            return data
        except (ValidationError, AttributeError, TypeError, ValueError) as cause:
            raise self.invalid_response(write) from cause

    def work(self, work_id: str, reconcile: bool = False) -> WorkView:
        data = self.request("GET", _path(work_id), timeout_ms=10_000 if reconcile else 300_000)
        return WorkView.model_validate(
            self.validate(data, WorkView, matches=lambda work: work.id == work_id)
        )

    def artifact(self, work_id: str, kind: str, chapter: int | None = None) -> Artifact:
        work = self.work(work_id)
        artifact = next(
            (item for item in work.artifacts if item.kind == kind and item.chapter == chapter), None
        )
        if artifact is None:
            raise CliError("artifact-not-found", f"no {kind} artifact", status=404)
        return artifact

    def unknown_write(self, operation: Callable[[], Any]) -> Any:
        try:
            return operation()
        except CliError as cause:
            if cause.status is None or cause.status >= 500:
                cause.details = {**(cause.details or {}), "writeOutcome": "unknown"}
            raise


def execute_http_command(
    command: str,
    args: list[str],
    flags: dict[str, str],
    timeout_ms: int | None,
    env: Mapping[str, str],
    read_json: Callable[[str, str], Any],
    read_text: Callable[[str, str], str],
    transport: httpx.BaseTransport | None = None,
    logger: Callable[[str], None] | None = None,
) -> Any:
    client = HttpClient(
        flags.get("url", env.get("A4N_BASE_URL", "http://localhost:8787")), timeout_ms, transport
    )
    try:
        if command == "list":
            return client.validate(client.request("GET", "/api/works"), list[WorkSummary])
        if command == "config":
            return client.validate(client.request("GET", "/api/config"), AppConfigResponse)
        if command == "smoke":
            from .cli_smoke import run_smoke

            seed = flags["seed"] if "seed" in flags else read_text(flags["seed-file"], "Seed")
            return run_smoke(client, seed, flags.get("title"), logger or (lambda _line: None))
        work_id = args[0] if args else ""
        request: Any
        from .cli_special import SPECIAL_COMMANDS, execute_special_command

        if command in SPECIAL_COMMANDS:
            return execute_special_command(
                client, command, work_id, read_json(flags["file"], "Review command request")
            )
        if command == "create":
            seed = flags["seed"] if "seed" in flags else read_text(flags["seed-file"], "Seed")
            request = WorkCreateRequest.model_validate(
                {"seed": seed, **({"title": flags["title"]} if "title" in flags else {})}
            )
            return client.validate(
                client.request("POST", "/api/works", request),
                Work,
                write=True,
                matches=lambda work: _matches_created_work(work, request),
            )
        if command == "get":
            kind = flags.get("kind")
            if kind is not None and kind not in {
                "caption",
                "creative",
                "outline",
                "setting",
                "beat",
                "prose",
            }:
                raise CliError("invalid-input", "Unknown artifact kind")
            chapter = _integer(flags["chapter"], "chapter") if "chapter" in flags else None
            if (kind in {"beat", "prose"}) != (chapter is not None):
                raise CliError(
                    "usage", "Chapter artifacts require --chapter; work artifacts forbid it"
                )
            if kind is None:
                return client.work(work_id).model_dump(mode="json")
            return client.artifact(work_id, kind, chapter).model_dump(mode="json")
        if command == "advance":
            return client.validate(
                client.request("POST", _path(work_id, "/advance"), timeout_ms=1_820_000),
                AdvanceOutcomeDto,
                write=True,
                matches=lambda result: result.state.workId == work_id,
            )
        if command == "start-chapter":
            request = StartChapterRequest.model_validate(
                read_json(flags["file"], "Chapter request")
            )
            return client.validate(
                client.request(
                    "POST",
                    _path(work_id, "/chapters/start"),
                    request,
                    timeout_ms=920_000,
                    matches_error=lambda error: _matches_start_chapter(
                        error, work_id, request.chapter
                    ),
                ),
                AdvanceOutcomeDto,
                write=True,
                matches=lambda result: _matches_start_chapter(result, work_id, request.chapter),
            )
        if command == "select":
            creative = client.artifact(work_id, "creative")
            direction = args[1] if len(args) == 2 else creative.content.directions[0].directionId
            request = SelectCreativeRequest(
                directionId=direction, expectedHeadVersion=creative.version
            )
            return client.validate(
                client.request("POST", _path(work_id, "/artifacts/creative/select"), request),
                Artifact,
                write=True,
                matches=lambda result: (
                    creative.humanStatus == "pending"
                    and result.workId == work_id
                    and result.kind == "creative"
                    and result.chapter is None
                    and result.id != creative.id
                    and result.version == creative.version + 1
                    and result.humanStatus == "approved"
                    and result.content.directions
                    == [
                        item
                        for item in creative.content.directions
                        if item.directionId == request.directionId
                    ]
                ),
            )
        if command == "save-outline":
            outline = client.artifact(work_id, "outline")
            request = OutlineDraftRequest(
                content=read_json(flags["file"], "Outline draft"),
                expectedHeadVersion=outline.version,
            )
            return client.validate(
                client.request("PUT", _path(work_id, "/artifacts/outline"), request),
                Artifact,
                write=True,
                matches=lambda result: (
                    result.workId == work_id
                    and result.kind == "outline"
                    and result.chapter is None
                    and result.id != outline.id
                    and result.version == outline.version + 1
                    and result.humanStatus == "pending"
                    and result.content == normalize_outline_ids(work_id, request.content)
                ),
            )
        if command == "approve":
            kind = args[1]
            if kind in {"setting", "beat", "prose"}:
                raise CliError(
                    f"{kind}-approval-required", f"Use approve-{kind} with a complete request file"
                )
            request = ApproveRequest.model_validate({"kind": kind})
            return client.validate(
                client.request("POST", _path(work_id, "/approve"), request),
                PipelineState,
                write=True,
                matches=lambda result: _matches_generic_approval(result, work_id, kind),
            )
        if command == "approve-outline":
            request = OutlineApprovalRequest.model_validate(
                read_json(flags["file"], "Outline approval")
            )
            result = client.unknown_write(
                lambda: client.request(
                    "POST", _path(work_id, "/artifacts/outline/approve"), request, timeout_ms=30_000
                )
            )
            return client.validate(
                result,
                Artifact,
                write=True,
                matches=lambda artifact: (
                    artifact.workId == work_id
                    and artifact.kind == "outline"
                    and artifact.id == request.expectedArtifactId
                    and artifact.version == request.expectedHeadVersion
                    and artifact.humanStatus == "approved"
                ),
            )
        if command == "regenerate-creative":
            request = CreativeRegenerateRequest.model_validate(
                read_json(flags["file"], "Creative request")
            )
            try:
                response = client.request(
                    "POST",
                    _path(work_id, "/artifacts/creative/regenerate"),
                    request,
                    timeout_ms=920_000,
                    raw=True,
                )
            except CliError as cause:
                cause.details = {**(cause.details or {}), "writeOutcome": "unknown"}
                raise
            status, body = response["status"], response["body"]
            if 200 <= status < 300:
                return client.validate(
                    body,
                    Artifact,
                    write=True,
                    matches=lambda artifact: (
                        artifact.workId == work_id
                        and artifact.kind == "creative"
                        and artifact.humanStatus == "pending"
                        and artifact.version == (request.expectedHeadVersion or 0) + 1
                        and (
                            request.expectedArtifactId is None
                            or artifact.id != request.expectedArtifactId
                        )
                    ),
                )
            if status >= 500:
                raise CliError(
                    "creative-result-unknown",
                    "Creative regeneration result is unknown; "
                    "keep the request file and inspect the work",
                    details={"writeOutcome": "unknown"},
                )
            error = client.error_body(body, _path(work_id), True, None)
            raise CliError(
                error["code"], error["message"], status=status, retryable=error["retryable"]
            )
        if command == "logs":
            diagnostic = DiagnosticQuery.model_validate(
                {
                    **({"requestId": flags["request-id"]} if "request-id" in flags else {}),
                    **({"attemptId": flags["attempt-id"]} if "attempt-id" in flags else {}),
                }
            )
            params = urlencode(
                {key: value for key, value in diagnostic.model_dump().items() if value is not None}
            )
            return client.validate(
                client.request(
                    "GET", _path(work_id, f"/telemetry{'?' + params if params else ''}")
                ),
                DiagnosticResponse,
                matches=lambda result: result.workId == work_id,
            )
        if command == "agent-config":
            return client.validate(
                client.request("GET", _path(work_id, "/agent-config")),
                AuthorConfigView,
                matches=lambda result: result.workId == work_id,
            )
        if command == "save-agent-config":
            request = AuthorConfigSave.model_validate(
                read_json(flags["file"], "Author configuration")
            )
            response = client.unknown_write(
                lambda: client.request(
                    "PUT", _path(work_id, "/agent-config"), request, timeout_ms=30_000
                )
            )
            return client.validate(
                response,
                AuthorConfigReceipt,
                write=True,
                matches=lambda result: (
                    result.workId == work_id
                    and result.requestId == request.requestId
                    and result.revision == request.expectedRevision + 1
                    and result.document == request.document
                ),
            )
        if command in {"upload-skill", "upload-prompt"}:
            file_kind: Literal["skill", "prompt"] = (
                "skill" if command == "upload-skill" else "prompt"
            )
            request = AgentFileUpload(
                requestId=flags["request-id"],
                kind=file_kind,
                text=read_text(flags["file"], "Agent file"),
            )
            response = client.unknown_write(
                lambda: client.request(
                    "POST", _path(work_id, "/agent-files"), request, timeout_ms=30_000
                )
            )
            text = (
                request.text
                if file_kind == "skill"
                else (
                    "---\nname: author-prompt\ndescription: Author writing guidance\n---\n"
                    + request.text
                )
            )
            return client.validate(
                response,
                AgentFile,
                write=True,
                matches=lambda result: (
                    result.workId == work_id
                    and result.id == request.requestId
                    and result.kind == file_kind
                    and result.byteLength == len(text.encode())
                    and result.sha256 == hashlib.sha256(text.encode()).hexdigest()
                ),
            )
        if command == "get-agent-file":
            file_id = args[1]
            return client.validate(
                client.request("GET", _path(work_id, f"/agent-files/{_safe_id(file_id)}")),
                AgentFileRead,
                matches=lambda result: (
                    result.file.workId == work_id
                    and result.file.id == file_id
                    and result.file.byteLength == len(result.text.encode())
                    and result.file.sha256 == hashlib.sha256(result.text.encode()).hexdigest()
                ),
            )
        if command == "mark-bad-example":
            request = BadExampleRequest.model_validate(read_json(flags["file"], "Bad example"))
            response = client.unknown_write(
                lambda: client.request(
                    "POST", _path(work_id, "/bad-examples"), request, timeout_ms=30_000
                )
            )
            return client.validate(
                response,
                BadExample,
                write=True,
                matches=lambda result: matches_bad_example(result, work_id, request.model_dump()),
            )
        if command == "bad-examples":
            query = {key: _integer(flags[key], key) for key in ("chapter", "after") if key in flags}
            return client.validate(
                client.request(
                    "GET", _path(work_id, f"/bad-examples{'?' + urlencode(query) if query else ''}")
                ),
                BadExamplePage,
                matches=lambda result: (
                    result.workId == work_id
                    and result.chapter == query.get("chapter")
                    and result.after == query.get("after")
                ),
            )
        if command == "bad-example":
            sample_id = args[1]
            return client.validate(
                client.request("GET", _path(work_id, f"/bad-examples/{_safe_id(sample_id)}")),
                BadExample,
                matches=lambda result: result.workId == work_id and result.id == sample_id,
            )
        raise CliError("usage", "Unknown command; use --help")
    except ValidationError as cause:
        raise CliError(
            "invalid-input",
            "Invalid command input or request file",
            issues=validation_metadata(cause)["issues"],
            details={
                key: value for key, value in validation_metadata(cause).items() if key != "issues"
            },
        ) from cause
    finally:
        client.close()
