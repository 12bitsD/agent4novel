import hashlib
import json
import sqlite3
from pathlib import Path

from work_fixtures import CREATED_AT, WORK_ID, populate

SKILL_ID = "22222222-2222-4222-8222-222222222222"
CONFIG_REQUEST_ID = "11111111-1111-4111-8111-111111111111"
EXTENSION_REQUEST_ID = "33333333-3333-4333-8333-333333333333"
BAD_EXAMPLE_ID = "44444444-4444-4444-8444-444444444444"
SKILL_TEXT = "---\nname: plain-writing\ndescription: 简洁\n---\nUse concrete actions.\n"
DOCUMENT = {
    "preferences": {"style": "简洁", "genre": "都市", "payoff": "成长"},
    "defaults": {"model": "kimi:kimi-k2.8-highspeed", "temperature": 0.25, "topP": 0.8},
    "steps": {"caption": {"directionCount": 1}, "prose": {"skills": [SKILL_ID]}},
}
EXTENSION = {
    "sectionId": "section-1",
    "title": "新人物",
    "items": [{"itemId": "item-1", "title": "证人", "content": "关键证人"}],
}
PROSE_TEXT = "第一章正文。"


def populate_resources(path: Path) -> tuple[object, Path]:
    store = populate(path)
    db = sqlite3.connect(path)
    db.execute(
        "INSERT INTO author_configs "
        "(work_id, revision, request_id, expected_revision, document) "
        "VALUES (?, ?, ?, ?, ?)",
        (WORK_ID, 1, CONFIG_REQUEST_ID, 0, json.dumps(DOCUMENT, ensure_ascii=False)),
    )
    metadata = {
        "id": SKILL_ID,
        "workId": WORK_ID,
        "kind": "skill",
        "name": "plain-writing",
        "description": "简洁",
        "sha256": hashlib.sha256(SKILL_TEXT.encode()).hexdigest(),
        "byteLength": len(SKILL_TEXT.encode()),
        "createdAt": CREATED_AT,
    }
    db.execute(
        "INSERT INTO agent_files (id, work_id, metadata) VALUES (?, ?, ?)",
        (SKILL_ID, WORK_ID, json.dumps(metadata, ensure_ascii=False)),
    )
    expected_base = {"artifactId": "setting-1", "version": 1}
    request = {
        "workId": WORK_ID,
        "requestId": EXTENSION_REQUEST_ID,
        "expectedBase": expected_base,
        "extension": {
            "title": EXTENSION["title"],
            "items": [{"title": "证人", "content": "关键证人"}],
        },
    }
    record = {
        "workId": WORK_ID,
        "requestId": EXTENSION_REQUEST_ID,
        "expectedBase": expected_base,
        "request": request,
        "extension": EXTENSION,
        "status": "pending",
        "candidate": None,
        "createdAt": CREATED_AT,
        "updatedAt": CREATED_AT,
    }
    db.execute(
        "INSERT INTO setting_extension_proposals (work_id, request_id, record) VALUES (?, ?, ?)",
        (WORK_ID, EXTENSION_REQUEST_ID, json.dumps(record, ensure_ascii=False)),
    )
    source_hash = hashlib.sha256(PROSE_TEXT.encode()).hexdigest()
    for index in range(51):
        sample_id = BAD_EXAMPLE_ID if index == 0 else f"{index:08x}-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        record = {
            "id": sample_id,
            "workId": WORK_ID,
            "chapter": 1,
            "sourceArtifactId": "prose-1",
            "sourceVersion": 1,
            "sourceHash": source_hash,
            "start": 0,
            "end": len(PROSE_TEXT.encode("utf-16-le")) // 2,
            "text": PROSE_TEXT,
            "note": "",
            "createdAt": CREATED_AT,
        }
        request = {
            "requestId": sample_id,
            **{
                key: value
                for key, value in record.items()
                if key not in {"id", "workId", "createdAt"}
            },
        }
        db.execute(
            "INSERT INTO bad_examples (id, work_id, chapter, record, request) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                sample_id,
                WORK_ID,
                1,
                json.dumps(record, ensure_ascii=False),
                json.dumps(request, ensure_ascii=False),
            ),
        )
    db.commit()
    db.close()
    data_dir = path.parent
    file_dir = (
        data_dir
        / "prompts"
        / hashlib.sha256(WORK_ID.encode()).hexdigest()
        / SKILL_ID
        / "plain-writing"
    )
    file_dir.mkdir(parents=True)
    (file_dir / "SKILL.md").write_text(SKILL_TEXT)
    return store, data_dir
