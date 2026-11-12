import hashlib
import sqlite3
from pathlib import Path

import pytest
from work_fixtures import CREATIVE, WORK_ID, populate

from agent4novel.store.sqlite import SqliteReadStore, StoreContractError, UnsupportedDatabaseError


def test_v4_read_store_heads_history_and_bytes(tmp_path: Path) -> None:
    path = tmp_path / "agent4novel.sqlite"
    store = populate(path)
    before = hashlib.sha256(path.read_bytes()).hexdigest()

    summaries = store.list_works()
    assert len(summaries) == 1
    assert summaries[0].id == WORK_ID
    assert summaries[0].title == "测试作品"
    assert summaries[0].chapterCount == 0
    assert summaries[0].seedPreview.endswith("…")

    work = store.get_work(WORK_ID)
    assert work is not None
    assert len(work.artifacts) == 6
    assert work.artifacts[1].id == "creative-2"
    assert work.artifacts[1].content.directions[0].directionId == "direction-1"
    assert store.get_artifact_version(WORK_ID, "creative", None, "creative-1", 1) is not None
    assert store.get_artifact_version(WORK_ID, "creative", None, "creative-2", 2) is not None
    assert store.get_artifact_version(WORK_ID, "creative", None, "creative-1", 3) is None
    assert store.get_artifact_version(WORK_ID, "prose", 1, "prose-1", 1) is not None
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    assert sqlite3.connect(path).execute("PRAGMA user_version").fetchone()[0] == 4
    store.close()


def test_invalid_stored_content_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "agent4novel.sqlite"
    store = populate(path)
    db = sqlite3.connect(path)
    invalid = {"directions": [*CREATIVE["directions"], *CREATIVE["directions"]]}
    import json

    db.execute(
        "UPDATE artifacts SET content = ? WHERE id = ?",
        (json.dumps(invalid, ensure_ascii=False), "creative-2"),
    )
    db.commit()
    db.close()
    with pytest.raises(StoreContractError):
        store.get_work(WORK_ID)
    store.close()


def test_unknown_schema_fails_closed(tmp_path: Path) -> None:
    path = tmp_path / "agent4novel.sqlite"
    store = populate(path)
    store.close()
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE unexpected (id TEXT)")
    db.commit()
    db.close()
    with pytest.raises(UnsupportedDatabaseError):
        SqliteReadStore(path)
