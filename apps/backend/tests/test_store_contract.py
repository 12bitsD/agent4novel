from pathlib import Path

import pytest
from work_fixtures import BEAT, CAPTION, CREATIVE, OUTLINE, SEED, SETTING

from agent4novel.domain.work import ArtifactInput, CreativeContent
from agent4novel.errors import KnownError
from agent4novel.store.memory import InMemoryStore
from agent4novel.store.work import ArtifactHead, ArtifactPrecondition, SqliteStore


def approved(
    kind: str,
    artifact: object,
    chapter: int | None = None,
    status: str = "approved",
) -> ArtifactPrecondition:
    return ArtifactPrecondition(
        kind=kind,
        **({} if chapter is None else {"chapter": chapter}),
        head=ArtifactHead(
            artifactId=artifact.id,
            version=artifact.version,
            humanStatus=status,
        ),
    )


@pytest.mark.parametrize("backend", ["memory", "sqlite"])
def test_shared_store_write_contract(backend: str, tmp_path: Path) -> None:
    store = InMemoryStore() if backend == "memory" else SqliteStore(tmp_path / "agent4novel.sqlite")
    work = store.create_work(SEED, title="  ")
    assert work.config.model_dump() == {}
    assert work.title
    caption = store.append_artifact(work.id, "caption", CAPTION, human_status="approved")
    pending = store.append_artifact(work.id, "creative", CREATIVE)
    with pytest.raises(KnownError) as conflict:
        store.append_artifact(
            work.id,
            "creative",
            CREATIVE,
            preconditions=[ArtifactPrecondition(kind="creative", head=None)],
        )
    assert conflict.value.code == "version-conflict"
    assert store.get_work(work.id).artifacts[-1].version == 1

    selected = store.append_artifact(
        work.id,
        "creative",
        CreativeContent(directions=[pending.content.directions[0]]),
        human_status="approved",
        inputs=[ArtifactInput(kind="caption", artifactId=caption.id, version=1)],
        preconditions=[approved("creative", pending, status="pending")],
    )
    outline = store.append_artifact(
        work.id,
        "outline",
        OUTLINE,
        preconditions=[approved("caption", caption), approved("creative", selected)],
    )
    store.set_status(
        work.id,
        "outline",
        "approved",
        preconditions=[
            ArtifactPrecondition(
                kind="outline",
                head=ArtifactHead(
                    artifactId=outline.id, version=outline.version, humanStatus="pending"
                ),
            )
        ],
    )
    setting = store.append_artifact(
        work.id,
        "setting",
        SETTING,
        preconditions=[approved("outline", outline)],
    )
    finalized_setting = store.finalize_artifact(
        work.id,
        "setting",
        chapter=None,
        expected_artifact_id=setting.id,
        expected_head_version=1,
        content=SETTING,
        preconditions=[approved("outline", outline)],
    )
    assert finalized_setting.id == setting.id
    assert finalized_setting.version == 1
    assert finalized_setting.createdAt == setting.createdAt
    assert finalized_setting.humanStatus == "approved"

    beat = store.append_artifact(
        work.id,
        "beat",
        BEAT,
        chapter=1,
        preconditions=[approved("setting", finalized_setting)],
    )
    store.finalize_artifact(
        work.id,
        "beat",
        chapter=1,
        expected_artifact_id=beat.id,
        expected_head_version=1,
        content=BEAT,
        preconditions=[approved("setting", finalized_setting)],
    )
    prose = store.append_artifact(
        work.id,
        "prose",
        {"text": "第一版正文"},
        chapter=1,
        inputs=[
            ArtifactInput(kind="beat", chapter=1, artifactId=beat.id, version=1),
            ArtifactInput(kind="setting", artifactId=finalized_setting.id, version=1),
        ],
        preconditions=[approved("beat", beat, 1), approved("setting", finalized_setting)],
    )
    saved = store.save_artifact(
        work.id,
        "prose",
        chapter=1,
        expected_artifact_id=prose.id,
        expected_head_version=1,
        expected_human_status="pending",
        content={"text": "第二版正文"},
    )
    assert saved.id != prose.id
    assert saved.version == 2
    assert saved.humanStatus == "pending"
    approved_prose = store.finalize_artifact(
        work.id,
        "prose",
        chapter=1,
        expected_artifact_id=saved.id,
        expected_head_version=2,
        content={"text": "第二版正文"},
    )
    edited = store.save_artifact(
        work.id,
        "prose",
        chapter=1,
        expected_artifact_id=approved_prose.id,
        expected_head_version=2,
        expected_human_status="approved",
        content={"text": "通过后第三版正文"},
    )
    assert edited.version == 3
    assert edited.humanStatus == "approved"
    assert edited.inputs == prose.inputs
    assert store.get_artifact_version(work.id, "prose", 1, prose.id, 1).content.text == "第一版正文"
    assert store.get_artifact_version(work.id, "prose", 1, saved.id, 2).content.text == "第二版正文"
    assert store.get_work(work.id).artifacts[-1].id == edited.id
    assert store.list_works()[0].chapterCount == 1

    assert [artifact.kind for artifact in store.get_work(work.id).artifacts] == [
        "caption",
        "creative",
        "outline",
        "setting",
        "beat",
        "prose",
    ]

    external = store.get_work(work.id)
    original_title = external.artifacts[1].content.directions[0].title
    external.artifacts[1].content.directions[0].title = "外部修改"
    assert store.get_work(work.id).artifacts[1].content.directions[0].title == original_title
    store.close()


@pytest.mark.parametrize("backend", ["memory", "sqlite"])
def test_extension_and_bad_example_store_contract(backend: str, tmp_path: Path) -> None:
    from agent4novel.domain.resources import (
        BadExampleRequest,
        SettingExtensionActionRequest,
        SettingExtensionProposeRequest,
    )
    from agent4novel.store.resources import SqliteResourceStore

    store = (
        InMemoryStore()
        if backend == "memory"
        else SqliteResourceStore(tmp_path / "agent4novel.sqlite")
    )
    work = store.create_work(SEED)
    setting = store.append_artifact(work.id, "setting", SETTING)
    setting = store.finalize_artifact(
        work.id,
        "setting",
        chapter=None,
        expected_artifact_id=setting.id,
        expected_head_version=1,
        content=SETTING,
    )
    request = SettingExtensionProposeRequest.model_validate(
        {
            "requestId": "55555555-5555-4555-8555-555555555555",
            "expectedBase": {"artifactId": setting.id, "version": 1},
            "extension": {"title": "新势力", "items": [{"title": "守夜人", "content": "维护秩序"}]},
        }
    )
    proposed = store.propose_setting_extension(work.id, request)
    assert proposed.writeOutcome == "committed"
    assert store.propose_setting_extension(work.id, request) == proposed
    action = SettingExtensionActionRequest(
        requestId=request.requestId,
        expectedBase=request.expectedBase,
    )
    approved = store.approve_setting_extension(work.id, action)
    assert approved.candidate is not None and approved.candidate.version == 2
    assert store.approve_setting_extension(work.id, action) == approved
    head = next(a for a in store.get_work(work.id).artifacts if a.kind == "setting")
    assert head.version == 2 and head.humanStatus == "approved"
    assert head.inputs[0].artifactId == setting.id
    assert head.content.extensions[-1].items[0].title == "守夜人"
    with pytest.raises(KnownError) as conflict:
        store.cancel_setting_extension(work.id, action)
    assert conflict.value.code == "setting-extension-state-conflict"

    prose = store.append_artifact(work.id, "prose", {"text": "开头😀中段，结尾"}, chapter=1)
    import hashlib

    bad = BadExampleRequest.model_validate(
        {
            "requestId": "66666666-6666-4666-8666-666666666666",
            "chapter": 1,
            "sourceArtifactId": prose.id,
            "sourceVersion": 1,
            "sourceHash": hashlib.sha256(prose.content.text.encode()).hexdigest(),
            "start": 2,
            "end": 6,
            "text": "😀中段",
            "note": "检查口吻",
        }
    )
    saved = store.mark_bad_example(work.id, bad)
    assert store.mark_bad_example(work.id, bad) == saved
    assert store.get_bad_example(work.id, bad.requestId).text == "😀中段"
    assert store.list_bad_examples(work.id, chapter=1).items == [saved]
    store.save_artifact(
        work.id,
        "prose",
        chapter=1,
        expected_artifact_id=prose.id,
        expected_head_version=1,
        expected_human_status="pending",
        content={"text": "新版"},
    )
    assert store.get_bad_example(work.id, saved.id).sourceVersion == 1
    store.close()
