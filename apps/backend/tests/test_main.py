from fastapi.testclient import TestClient

from agent4novel.main import create_app


def test_health_and_demo_config() -> None:
    client = TestClient(create_app({}))
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    config = client.get("/api/config")
    assert config.status_code == 200
    assert config.json() == {"demo": True}


def test_live_config_uses_provider_credentials() -> None:
    client = TestClient(create_app({"KIMI_API_KEY": "synthetic"}))
    response = client.get("/api/config")
    assert response.status_code == 200
    assert response.json() == {"demo": False}


def test_not_found_uses_public_error_shape() -> None:
    client = TestClient(create_app({}))
    response = client.get("/api/not-found")
    assert response.status_code == 404
    assert response.json() == {
        "code": "not-found",
        "message": "route not found",
        "retryable": False,
    }
