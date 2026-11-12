import json
import sqlite3
from pathlib import Path

from agent4novel.store.sqlite import SqliteReadStore

WORK_ID = "work-1"
SEED = (
    "一个都市异能校园故事，主角在雨夜发现自己的名字从所有人的记忆里消失了。"
    "第二天，他不得不开始寻找真相。"
)
CREATED_AT = "2026-01-01T00:00:00.000Z"

CAPTION = {
    "inputStage": "脑洞",
    "summary": "合成提炼",
    "elements": [{"kind": "人物", "content": "主角"}],
    "gaps": [],
}
CREATIVE = {
    "directions": [
        {
            "directionId": "direction-1",
            "title": "方向",
            "hook": "钩子",
            "tags": [],
            "synopsis": "概要",
            "characters": [],
            "setting": [],
            "payoffs": [],
            "outline": [],
        }
    ]
}
OUTLINE = {
    "arcs": [
        {
            "arcId": f"arc-{i}",
            "title": "弧线",
            "conflict": "冲突",
            "development": "发展",
            "resolution": "收束",
            "segments": [
                {
                    "segmentId": f"segment-{i}-1",
                    "title": "点一",
                    "summary": "发生",
                    "outcome": "变化",
                },
                {
                    "segmentId": f"segment-{i}-2",
                    "title": "点二",
                    "summary": "发生",
                    "outcome": "变化",
                },
            ],
        }
        for i in [1, 2, 3]
    ]
}
SETTING = {
    "overview": "城市",
    "world": [{"itemId": "world-1", "title": "规则", "content": "现实"}],
    "characters": [{"itemId": "character-1", "title": "主角", "content": "追查"}],
    "factions": [],
    "relationships": [],
    "extensions": [],
}
BEAT = {
    "title": "第一章",
    "goal": "推进",
    "writingPlan": [{"itemId": "plan-1", "title": "行动", "content": "继续追踪"}],
    "ending": "留下线索",
}
PROSE = {"text": "第一章正文。"}


def insert_artifact(
    db: sqlite3.Connection,
    artifact_id: str,
    kind: str,
    version: int,
    content: dict,
    status: str,
    chapter: int | None = None,
    inputs: list | None = None,
) -> None:
    db.execute(
        "INSERT INTO artifacts (id, work_id, kind, chapter, version, content, human_status, "
        "created_at, inputs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            artifact_id,
            WORK_ID,
            kind,
            chapter,
            version,
            json.dumps(content, ensure_ascii=False),
            status,
            CREATED_AT,
            json.dumps(inputs, ensure_ascii=False) if inputs is not None else None,
        ),
    )


def populate(path: Path) -> SqliteReadStore:
    store = SqliteReadStore(path)
    db = sqlite3.connect(path)
    db.execute(
        "INSERT INTO works (id, title, seed, config, created_at) VALUES (?, ?, ?, ?, ?)",
        (WORK_ID, "测试作品", SEED, "{}", CREATED_AT),
    )
    insert_artifact(db, "caption-1", "caption", 1, CAPTION, "approved")
    insert_artifact(db, "creative-1", "creative", 1, CREATIVE, "pending")
    insert_artifact(db, "creative-2", "creative", 2, CREATIVE, "pending")
    insert_artifact(db, "outline-1", "outline", 1, OUTLINE, "approved")
    insert_artifact(db, "setting-1", "setting", 1, SETTING, "approved")
    insert_artifact(db, "beat-1", "beat", 1, BEAT, "approved", 1)
    insert_artifact(
        db,
        "prose-1",
        "prose",
        1,
        PROSE,
        "pending",
        1,
        [{"kind": "beat", "chapter": 1, "artifactId": "beat-1", "version": 1}],
    )
    db.commit()
    db.close()
    return store
