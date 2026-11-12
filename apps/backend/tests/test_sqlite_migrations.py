import json
import sqlite3
from pathlib import Path

import pytest

from agent4novel.store.sqlite import (
    ADDITIONS_V2,
    ADDITIONS_V3,
    SCHEMA_V1,
    SqliteReadStore,
)


@pytest.mark.parametrize("version", [1, 2, 3])
def test_old_schemas_migrate_without_losing_work(version: int, tmp_path: Path) -> None:
    path = tmp_path / "agent4novel.sqlite"
    db = sqlite3.connect(path)
    schema = [*SCHEMA_V1]
    if version >= 2:
        schema.extend(ADDITIONS_V2)
    if version >= 3:
        schema.extend(ADDITIONS_V3)
    for _, _, statement in schema:
        db.execute(statement)
    db.execute(
        "INSERT INTO works (id, title, seed, config, created_at) VALUES (?, ?, ?, ?, ?)",
        ("work-migration", "迁移作品", "需要保留的脑洞", "{}", "2026-01-01T00:00:00.000Z"),
    )
    db.execute(
        "INSERT INTO artifacts "
        "(id, work_id, kind, chapter, version, content, human_status, created_at, inputs) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "caption-1",
            "work-migration",
            "caption",
            None,
            1,
            json.dumps({"inputStage": "脑洞", "summary": "保留", "elements": [], "gaps": []}),
            "approved",
            "2026-01-01T00:00:00.000Z",
            None,
        ),
    )
    db.execute(f"PRAGMA user_version = {version}")
    db.commit()
    db.close()

    store = SqliteReadStore(path)
    work = store.get_work("work-migration")
    assert work is not None
    assert work.title == "迁移作品"
    assert work.artifacts[0].id == "caption-1"
    assert store.db.execute("PRAGMA user_version").fetchone()[0] == 4
    assert store.db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert store.db.execute("PRAGMA synchronous").fetchone()[0] == 2
    assert store.db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    store.close()
