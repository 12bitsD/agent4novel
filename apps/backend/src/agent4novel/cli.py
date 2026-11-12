import argparse
import asyncio
import contextlib
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Never, TextIO

import httpx

from .agent.isolated import STEP_IDS, StepExperimentRequest, run_isolated_step
from .agent.recording import (
    StepRecordError,
    git_version,
    mark_step_record_unknown,
    reserve_step_record_dir,
)
from .agent.runtime import ModelRuntime
from .cli_http import (
    CliError,
    cli_error_json,
    execute_http_command,
    parse_cli_timeout,
    parse_command,
)
from .config import ModelConfigError, repository_root, runtime_environment

FILE_BYTES = 1024 * 1024
HELP = """a4n run-step <caption|creative|outline|setting|beat|prose> --input-file <f>
  | --seed-file <f>
  [--system-prompt-file <sp>] [--config-file <f>] [--record-dir <dir>]
  [--thinking on|off] [--temperature 0..1] [--top-p 0..1] [--timeout-ms <ms>]

独立运行生产节点，使用真实 provider，不创建或修改作品。
input-file: {"seed":"素材","upstream":{...},"chapter":<Beat/Prose章号>,
  "regeneration":{"content":<当前步骤内容>,"instructions":"补充想法"}}
Beat需outline/setting，Prose需beat/setting；chapter>1需upstream.previousChapter。
config-file 仅接受 model/directionCount/thinking/temperature/topP；flags 按字段覆盖。
--record-dir 必须是不存在的目录；父目录须已存在且不能包含符号链接。
--record-dir 写入 input.json、invocation.json、result.json、meta.json。
不支持 --url 和 --top-k。
其他作品命令: list/config/create/get/advance/start-chapter/select/save-outline/smoke/
approve/approve-outline/regenerate-creative/logs/agent-config/save-agent-config/
approve-setting/approve-beat/regenerate-beat/select-beat-variant/
approve-prose/regenerate-prose/save-prose/
upload-skill/upload-prompt/get-agent-file/mark-bad-example/bad-examples/bad-example。
普通写操作不自动重发；advance/start-chapter 的 kind:failed 仍 exit 0。"""


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> Never:
        raise CliError("usage", message)


def _parser(env: Mapping[str, str] | None = None) -> Parser:
    parser = Parser(prog="a4n run-step", add_help=False)
    parser.add_argument("stepId", choices=list(STEP_IDS))
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input-file")
    source.add_argument("--seed-file")
    parser.add_argument("--system-prompt-file")
    parser.add_argument("--config-file")
    parser.add_argument("--record-dir")
    parser.add_argument("--thinking")
    parser.add_argument("--temperature")
    parser.add_argument("--top-p")
    raw_timeout = env.get("A4N_CLI_TIMEOUT_MS") if env is not None else None
    timeout = parse_cli_timeout(raw_timeout) if raw_timeout is not None else 920_000
    parser.add_argument("--timeout-ms", type=int, default=timeout)
    return parser


def _text_file(path: str, label: str) -> str:
    try:
        data = Path(path).read_bytes()
    except OSError as error:
        raise CliError("invalid-input", f"{label} could not be read") from error
    if len(data) > FILE_BYTES:
        raise CliError("payload-too-large", f"{label} exceeds 1 MiB")
    try:
        return data.decode("utf-8")
    except UnicodeError as error:
        raise CliError("invalid-input", f"{label} must be UTF-8") from error


def _json_file(path: str, label: str) -> Any:
    try:
        return json.loads(_text_file(path, label))
    except json.JSONDecodeError as error:
        raise CliError("invalid-input", f"{label} must be valid JSON") from error


def _number(value: str) -> float:
    try:
        return float(value)
    except ValueError as error:
        raise CliError("invalid-input", "Invalid step experiment input or options") from error


def _request(options: argparse.Namespace) -> StepExperimentRequest:
    if options.thinking is not None and options.thinking not in {"on", "off"}:
        raise CliError("invalid-input", "--thinking must be on or off")
    input_value = (
        _json_file(options.input_file, "Step input")
        if options.input_file
        else {"seed": _text_file(options.seed_file, "Step seed"), "upstream": {}}
    )
    value = {
        "stepId": options.stepId,
        "input": input_value,
        **(
            {"systemPrompt": _text_file(options.system_prompt_file, "Step system prompt")}
            if options.system_prompt_file
            else {}
        ),
        **(
            {"config": _json_file(options.config_file, "Step config")}
            if options.config_file
            else {}
        ),
    }
    try:
        parsed = StepExperimentRequest.model_validate(value)
        overrides = {
            **(
                {"thinking": "enabled" if options.thinking == "on" else "disabled"}
                if options.thinking is not None
                else {}
            ),
            **(
                {"temperature": _number(options.temperature)}
                if options.temperature is not None
                else {}
            ),
            **({"topP": _number(options.top_p)} if options.top_p is not None else {}),
        }
        if overrides:
            value["config"] = {
                **(parsed.config.model_dump(exclude_none=True) if parsed.config else {}),
                **overrides,
            }
        return StepExperimentRequest.model_validate(value)
    except Exception as error:
        if isinstance(error, CliError):
            raise
        raise CliError("invalid-input", "Invalid step experiment input or options") from error


def _record(options: argparse.Namespace, root: Path) -> dict[str, Any] | None:
    if options.record_dir is None:
        return None
    try:
        directory = reserve_step_record_dir(options.record_dir)
    except StepRecordError as error:
        code = "recording-collision" if "collision" in error.reason else "recording-path-invalid"
        raise CliError(code, "Unable to reserve a private record directory") from error
    source = Path(options.input_file or options.seed_file).resolve()
    return {
        "dir": str(directory),
        "sources": {
            "input": "input-file" if options.input_file else "seed-file",
            "inputPath": str(source),
            "systemPromptPath": str(Path(options.system_prompt_file).resolve())
            if options.system_prompt_file
            else None,
            "configPath": str(Path(options.config_file).resolve()) if options.config_file else None,
        },
        "version": git_version(root),
    }


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    runtime: ModelRuntime | None = None,
    root: Path | None = None,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
    transport: httpx.BaseTransport | None = None,
) -> int:
    output = stdout or sys.stdout
    errors = stderr or sys.stderr
    arguments = list(argv if argv is not None else sys.argv[1:])
    if any(value in {"--help", "-h"} for value in arguments):
        errors.write(HELP + "\n")
        return 0
    values = env if env is not None else runtime_environment(root or repository_root())
    if not arguments or arguments[0] != "run-step":

        def log(line: str) -> None:
            errors.write(line + "\n")

        try:
            command, args, flags, timeout = parse_command(arguments, values)
            result = execute_http_command(
                command,
                args,
                flags,
                timeout,
                values,
                _json_file,
                _text_file,
                transport,
                logger=log,
            )
            output.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
            return 0
        except CliError as error:
            errors.write(cli_error_json(error) + "\n")
            return 1
    request: StepExperimentRequest | None = None
    try:
        if "--top-k" in arguments:
            raise CliError("usage", "--top-k is not supported; use --top-p instead")
        options = _parser(values).parse_args(arguments[1:])
        parse_cli_timeout(str(options.timeout_ms))
        parsed = _request(options)
        record = _record(options, root or Path.cwd())
        if record is not None:
            request = StepExperimentRequest.model_validate(
                {**parsed.model_dump(exclude_none=True), "record": record}
            )
        else:
            request = parsed
        payload = json.dumps(request.model_dump(mode="json"), ensure_ascii=False).encode()
        if len(payload) > FILE_BYTES:
            raise CliError("payload-too-large", "Combined step experiment request exceeds 1 MiB")
        selected_runtime = runtime or ModelRuntime(
            env if env is not None else runtime_environment(root or repository_root())
        )

        async def execute() -> dict[str, Any]:
            deadline = asyncio.Event()
            task = asyncio.create_task(
                run_isolated_step(request, selected_runtime, cancel_event=deadline)
            )
            done, _ = await asyncio.wait({task}, timeout=options.timeout_ms / 1000)
            if task in done:
                return task.result()
            deadline.set()
            task.cancel()
            with contextlib.suppress(BaseException):
                await task
            if request.record is not None:
                mark_step_record_unknown(
                    request.record,
                    request.stepId,
                    request.input,
                    request.config.model if request.config and request.config.model else "unknown",
                    "cli-timeout",
                )
            raise CliError(
                "network-error",
                "Step timed out; the remote provider may still process the request",
                retryable=True,
            )

        result = asyncio.run(execute())
        if result["kind"] == "failed":
            raise CliError(
                result["code"],
                "Step experiment failed; inspect telemetry before retrying",
                retryable=result["retryable"],
                details=result,
            )
        output.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
        return 0
    except CliError as error:
        errors.write(
            json.dumps(
                {
                    "code": error.code,
                    "message": error.message,
                    "retryable": error.retryable,
                    **({"details": error.details} if error.details is not None else {}),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
            + "\n"
        )
        return 1
    except ModelConfigError:
        if request is not None and request.record is not None:
            mark_step_record_unknown(
                request.record, request.stepId, request.input, "unknown", "llm-config-invalid"
            )
        errors.write(
            json.dumps(
                {
                    "code": "llm-config-invalid",
                    "message": "Local model configuration is invalid",
                    "retryable": False,
                },
                separators=(",", ":"),
            )
            + "\n"
        )
        return 1
    except Exception:
        if request is not None and request.record is not None:
            mark_step_record_unknown(
                request.record, request.stepId, request.input, "unknown", "worker-failed"
            )
        errors.write(
            '{"code":"step-worker-failed","message":"Local step worker failed","retryable":false}\n'
        )
        return 1
