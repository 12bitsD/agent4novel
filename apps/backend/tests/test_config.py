from pathlib import Path

import pytest

from agent4novel.config import (
    ModelConfigError,
    ServerConfigError,
    model_is_demo,
    parse_server_config,
)


def test_default_config_matches_node_behavior() -> None:
    root = Path("/tmp/agent4novel-test").resolve()
    config = parse_server_config({}, root)
    assert config.data_dir == root / ".data"
    assert config.database_path == root / ".data/agent4novel.sqlite"
    assert config.host == "127.0.0.1"
    assert config.port == 8787
    assert config.seed_demo is False
    assert config.serve_web is False


def test_container_and_custom_values() -> None:
    root = Path("/tmp/agent4novel-test").resolve()
    config = parse_server_config(
        {
            "A4N_DATA_DIR": "var/data",
            "A4N_CONTAINER": "1",
            "A4N_HOST": "0.0.0.0",
            "A4N_PORT": "0",
            "A4N_SEED_DEMO": "1",
            "A4N_SERVE_WEB": "1",
        },
        root,
    )
    assert config.data_dir == root / "var/data"
    assert config.host == "0.0.0.0"
    assert config.port == 0
    assert config.seed_demo is True
    assert config.serve_web is True


@pytest.mark.parametrize(
    "env",
    [
        {"A4N_HOST": "example.com"},
        {"A4N_CONTAINER": "yes"},
        {"A4N_PORT": "abc"},
        {"A4N_PORT": "65536"},
        {"A4N_DATA_DIR": "bad\x00path"},
        {"A4N_SEED_DEMO": "true"},
        {"A4N_SERVE_WEB": "true"},
    ],
)
def test_invalid_config_fails_closed(env: dict[str, str]) -> None:
    with pytest.raises(ServerConfigError):
        parse_server_config(env, Path("/tmp/agent4novel-test").resolve())


def test_demo_selection_and_provider_precedence() -> None:
    assert model_is_demo({}) is True
    assert model_is_demo({"DEEPSEEK_API_KEY": "synthetic"}) is False
    assert model_is_demo({"LONGCAT_API_KEY": "synthetic"}) is False
    assert model_is_demo({"MOONSHOT_API_KEY": "synthetic"}) is False
    assert model_is_demo({"DEEPSEEK_API_KEY": "synthetic", "LONGCAT_API_KEY": "synthetic"}) is False


def test_explicit_model_requires_valid_credential() -> None:
    with pytest.raises(ModelConfigError):
        model_is_demo({"A4N_MODEL": "kimi:kimi-k2.8-highspeed"})
    with pytest.raises(ModelConfigError):
        model_is_demo({"A4N_MODEL": "other:model", "KIMI_API_KEY": "synthetic"})
    assert (
        model_is_demo({"A4N_MODEL": "kimi:kimi-k2.8-highspeed", "KIMI_API_KEY": "synthetic"})
        is False
    )
