from pathlib import Path

import pytest
from pydantic import ValidationError
from work_fixtures import populate

from agent4novel.domain.resources import AuthorConfigDocument
from agent4novel.domain.work import AgentConfig, Artifact


def test_optional_fields_are_omitted_and_explicit_null_is_rejected(tmp_path: Path) -> None:
    config = AgentConfig()
    assert config.model_dump() == {}
    with pytest.raises(ValidationError):
        AgentConfig.model_validate({"model": None})

    store = populate(tmp_path / "agent4novel.sqlite")
    work = store.get_work("work-1")
    assert work is not None
    artifact = work.artifacts[0]
    assert isinstance(artifact, Artifact)
    assert "chapter" not in artifact.model_dump()
    with pytest.raises(ValidationError):
        Artifact.model_validate({**artifact.model_dump(), "chapter": None})
    store.close()


def test_only_nullable_author_prompt_reference_serializes_null() -> None:
    document = AuthorConfigDocument.model_validate(
        {
            "preferences": {},
            "defaults": {"systemPromptRef": None},
            "steps": {},
        }
    )
    assert document.model_dump() == {
        "preferences": {},
        "defaults": {"systemPromptRef": None},
        "steps": {},
    }
    with pytest.raises(ValidationError):
        AuthorConfigDocument.model_validate(
            {"preferences": {"style": None}, "defaults": {}, "steps": {}}
        )
