import io
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_generation_pipeline import QueueProvider, response
from work_fixtures import CAPTION

from agent4novel.cli import main
from agent4novel.config import ModelConfigError, runtime_environment
from agent4novel.main import create_app
from agent4novel.store.resources import SqliteResourceStore


@pytest.fixture(autouse=True)
def isolate_provider_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "DEEPSEEK_API_KEY",
        "LONGCAT_API_KEY",
        "KIMI_API_KEY",
        "MOONSHOT_API_KEY",
        "A4N_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)


def test_env_file_parsing_precedence_and_no_shell_execution(tmp_path: Path, monkeypatch) -> None:
    marker = tmp_path / "must-not-exist"
    (tmp_path / ".env.local").write_text(
        "# synthetic values only\n"
        "KIMI_API_KEY='synthetic value'\n"
        "KIMI_BASE_URL='http://file.invalid'\n"
        "export A4N_MODEL=kimi:kimi-k2.8-highspeed\n"
        f"UNUSED='$(touch {marker})'\n"
    )
    monkeypatch.setenv("KIMI_BASE_URL", "http://process.invalid")
    values = runtime_environment(tmp_path)
    assert values["KIMI_API_KEY"] == "synthetic value"
    assert values["KIMI_BASE_URL"] == "http://process.invalid"
    assert values["A4N_MODEL"] == "kimi:kimi-k2.8-highspeed"
    assert values["UNUSED"] == f"$(touch {marker})"
    assert not marker.exists()
    monkeypatch.setenv("KIMI_API_KEY", "")
    assert runtime_environment(tmp_path)["KIMI_API_KEY"] == ""


def test_explicit_environment_never_reads_local_file(tmp_path: Path, monkeypatch) -> None:
    def forbidden(_: Any) -> bytes:
        raise AssertionError("local environment file must not be read")

    monkeypatch.setattr(Path, "read_bytes", forbidden)
    assert runtime_environment(tmp_path, {}) == {}


def test_invalid_env_file_fails_without_echoing_secrets(tmp_path: Path) -> None:
    (tmp_path / ".env.local").write_text("SECRET='unterminated-private-value")
    with pytest.raises(ModelConfigError) as error:
        runtime_environment(tmp_path)
    assert "private-value" not in str(error.value)
    (tmp_path / ".env.local").write_bytes(b"KEY=\xff")
    with pytest.raises(ModelConfigError):
        runtime_environment(tmp_path)
    (tmp_path / ".env.local").write_text("not an assignment")
    with pytest.raises(ModelConfigError):
        runtime_environment(tmp_path)


def test_app_loads_root_env_only_when_implicit(tmp_path: Path, monkeypatch) -> None:
    for name in ("KIMI_API_KEY", "MOONSHOT_API_KEY", "DEEPSEEK_API_KEY", "LONGCAT_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    (tmp_path / ".env.local").write_text("KIMI_API_KEY=synthetic-local\n")
    implicit = TestClient(create_app(root=tmp_path, store=SqliteResourceStore(":memory:")))
    assert implicit.get("/api/config").json() == {"demo": False}
    explicit = TestClient(create_app({}, root=tmp_path, store=SqliteResourceStore(":memory:")))
    assert explicit.get("/api/config").json() == {"demo": True}


def test_run_step_loads_env_from_explicit_root(tmp_path: Path, monkeypatch) -> None:
    from agent4novel.agent.runtime import ModelRuntime

    (tmp_path / ".env.local").write_text("KIMI_API_KEY=synthetic-local\n")
    seed = tmp_path / "seed.txt"
    seed.write_text("合成素材")
    provider = QueueProvider([response(CAPTION)])
    captured = {}

    def configured(values):
        captured.update(values)
        return ModelRuntime(values, provider_factory=lambda **kwargs: provider)

    monkeypatch.setattr("agent4novel.cli.ModelRuntime", configured)
    stdout = io.StringIO()
    stderr = io.StringIO()
    result = main(
        ["run-step", "caption", "--seed-file", str(seed)],
        root=tmp_path,
        stdout=stdout,
        stderr=stderr,
    )
    assert result == 0, stderr.getvalue()
    assert json.loads(stdout.getvalue())["kind"] == "succeeded"
    assert captured["KIMI_API_KEY"] == "synthetic-local"
    assert len(provider.requests) == 1


def test_run_step_timeout_env_is_checked_before_io(tmp_path: Path) -> None:
    from agent4novel.agent.runtime import ModelRuntime

    seed = tmp_path / "seed.txt"
    seed.write_text("合成素材")
    provider = QueueProvider([response(CAPTION)])
    stdout = io.StringIO()
    stderr = io.StringIO()
    result = main(
        ["run-step", "caption", "--seed-file", str(seed)],
        env={"A4N_CLI_TIMEOUT_MS": "10"},
        runtime=ModelRuntime(
            {"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: provider
        ),
        root=tmp_path,
        stdout=stdout,
        stderr=stderr,
    )
    assert result == 1
    assert json.loads(stderr.getvalue())["code"] == "usage"
    assert provider.requests == []

    stdout = io.StringIO()
    stderr = io.StringIO()
    result = main(
        ["run-step", "caption", "--seed-file", str(seed)],
        env={"A4N_CLI_TIMEOUT_MS": "1000"},
        runtime=ModelRuntime(
            {"KIMI_API_KEY": "synthetic"}, provider_factory=lambda **kwargs: provider
        ),
        root=tmp_path,
        stdout=stdout,
        stderr=stderr,
    )
    assert result == 0, stderr.getvalue()
    assert json.loads(stdout.getvalue())["kind"] == "succeeded"
