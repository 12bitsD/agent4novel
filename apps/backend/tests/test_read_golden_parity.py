import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from resource_fixtures import populate_resources

from agent4novel.main import create_app


def without_runtime_values(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: (
                f"<{key}>"
                if key in {"observedAt", "processInstanceId"}
                else without_runtime_values(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [without_runtime_values(item) for item in value]
    return value


def test_read_api_matches_golden_on_the_same_database(tmp_path: Path) -> None:
    data_dir = tmp_path
    store, _ = populate_resources(data_dir / "agent4novel.sqlite")
    expected = json.loads(
        (Path(__file__).parent / "fixtures" / "node_read_golden.json").read_text()
    )
    assert len(expected) == 32
    client = TestClient(create_app({"A4N_DATA_DIR": str(data_dir)}, root=data_dir, store=store))
    for reference in expected:
        response = client.get(reference["path"])
        assert response.status_code == reference["status"], reference["path"]
        assert without_runtime_values(response.json()) == without_runtime_values(
            reference["body"]
        ), reference["path"]
    store.close()
