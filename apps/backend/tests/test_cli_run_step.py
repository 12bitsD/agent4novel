import asyncio
import io
import json
import stat
from pathlib import Path
from typing import Any

from test_generation_pipeline import QueueProvider, response
from work_fixtures import CAPTION, SEED

from agent4novel.agent.runtime import ModelRuntime
from agent4novel.cli import main


def invoke(
    arguments: list[str], runtime: ModelRuntime | None, root: Path
) -> tuple[int, dict[str, Any], str]:
    stdout = io.StringIO()
    stderr = io.StringIO()
    code = main(arguments, runtime=runtime, root=root, stdout=stdout, stderr=stderr)
    if code:
        return code, json.loads(stderr.getvalue()), stderr.getvalue()
    return code, json.loads(stdout.getvalue()), stderr.getvalue()


def test_help_and_invalid_flags_have_no_side_effects(tmp_path: Path) -> None:
    stdout = io.StringIO()
    stderr = io.StringIO()
    result = main(
        ["run-step", "--help", "--seed-file", str(tmp_path / "missing")],
        stdout=stdout,
        stderr=stderr,
    )
    assert result == 0
    assert "--record-dir" in stderr.getvalue()
    assert stdout.getvalue() == ""
    code, error, _ = invoke(
        ["run-step", "caption", "--seed-file", "unused", "--top-k", "4"], None, tmp_path
    )
    assert code == 1
    assert error["code"] == "usage"


def test_cli_records_caption_and_private_files(tmp_path: Path) -> None:
    seed = tmp_path / "seed.txt"
    seed.write_text(SEED)
    prompt = tmp_path / "prompt.md"
    prompt.write_text("CUSTOM_SYSTEM")
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"temperature": 0.4, "topP": 0.6}))
    provider = QueueProvider([response(CAPTION)])
    runtime = ModelRuntime(
        {"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: provider
    )
    directory = tmp_path / "record"

    code, result, errors = invoke(
        [
            "run-step",
            "caption",
            "--seed-file",
            str(seed),
            "--system-prompt-file",
            str(prompt),
            "--config-file",
            str(config),
            "--record-dir",
            str(directory),
        ],
        runtime,
        tmp_path,
    )

    assert code == 0, errors
    assert result["kind"] == "succeeded"
    assert result["recording"]["status"] == "complete"
    invocation = json.loads((directory / "invocation.json").read_text())
    assert invocation["system"] == "CUSTOM_SYSTEM"
    assert invocation["effectiveConfig"]["temperature"] == 0.4
    assert invocation["effectiveConfig"]["topP"] == 0.6
    assert json.loads((directory / "input.json").read_text())["sources"]["inputPath"] == str(seed)
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert sorted(path.name for path in directory.iterdir()) == [
        "input.json",
        "invocation.json",
        "meta.json",
        "result.json",
    ]


def test_cli_timeout_marks_unknown_without_claiming_success(tmp_path: Path) -> None:
    class SlowProvider:
        async def complete(self, request: Any, *, attempt: int, cancel: Any) -> Any:
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

    seed = tmp_path / "seed.txt"
    seed.write_text("合成素材")
    directory = tmp_path / "record"
    runtime = ModelRuntime(
        {"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: SlowProvider()
    )
    code, result, _ = invoke(
        [
            "run-step",
            "caption",
            "--seed-file",
            str(seed),
            "--record-dir",
            str(directory),
            "--timeout-ms",
            "1000",
        ],
        runtime,
        tmp_path,
    )

    assert code == 1
    assert result["code"] == "network-error"
    recorded = json.loads((directory / "result.json").read_text())
    assert recorded["status"] == "unknown"
    assert recorded["diagnostic"]["code"] == "cli-timeout"
    meta = json.loads((directory / "meta.json").read_text())
    assert meta["complete"] is False
    assert meta["status"] == "incomplete"


def test_cli_record_collision_does_not_call_provider(tmp_path: Path) -> None:
    seed = tmp_path / "seed.txt"
    seed.write_text("合成素材")
    directory = tmp_path / "record"
    directory.mkdir()
    provider = QueueProvider([response(CAPTION)])
    runtime = ModelRuntime(
        {"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: provider
    )
    code, result, _ = invoke(
        ["run-step", "caption", "--seed-file", str(seed), "--record-dir", str(directory)],
        runtime,
        tmp_path,
    )

    assert code == 1
    assert result["code"] == "recording-collision"
    assert provider.requests == []
