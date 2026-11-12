from typing import Any, cast
from uuid import uuid4

from pydantic import Field, model_validator

from ..contracts import StrictModel
from ..domain.drafts import BeatEditDraft, BeatReviewDraft
from ..domain.work import AgentConfig, OutlineContent, PreviousChapter, SettingContent
from ..errors import KnownError
from ..services.review_content import assign_beat_ids
from ..text import utf16_length
from .recording import InvocationRecorder
from .runtime import ModelRuntime
from .steps import _json_for_prompt, system_for


class BeatDraft(BeatReviewDraft):
    @model_validator(mode="before")
    @classmethod
    def model_cannot_supply_ids(cls, value: Any) -> Any:
        if isinstance(value, dict):
            for item in value.get("writingPlan", []):
                if isinstance(item, dict) and "itemId" in item:
                    raise ValueError("model IDs are assigned by the server")
        return value


class BeatRegeneration(StrictModel):
    content: BeatEditDraft
    instructions: str = Field(max_length=10_000)


class BeatStep:
    def __init__(self, runtime: ModelRuntime, *, system_prompt: str | None = None) -> None:
        self.runtime = runtime
        self.system_prompt = system_prompt

    async def run(
        self,
        *,
        work_id: str,
        seed: str,
        chapter: int,
        outline: OutlineContent,
        setting: SettingContent,
        config: AgentConfig,
        regeneration: BeatRegeneration | None = None,
        previous_chapter: PreviousChapter | None = None,
        request_id: str | None = None,
        recorder: InvocationRecorder | None = None,
    ) -> Any:
        if chapter < 1:
            raise KnownError("invalid-input", "invalid chapter")
        if (chapter == 1 and previous_chapter is not None) or (
            chapter > 1 and (previous_chapter is None or previous_chapter.chapter != chapter - 1)
        ):
            raise KnownError(
                "invalid-input",
                "previousChapter must match chapter - 1 and must be absent for chapter 1",
            )
        system = system_for("beat", config, self.system_prompt)
        outline_json = _json_for_prompt(outline.model_dump())
        setting_json = _json_for_prompt(setting.model_dump())
        sections = [
            f"模式：{'regenerate' if regeneration else 'initial'}；当前章号：{chapter}",
            f"完整已通过大纲：\n{outline_json}",
            f"完整已通过设定：\n{setting_json}",
        ]
        if previous_chapter is not None:
            sections.append(
                f"完整已通过上一章（实际正文优先于章纲计划）：\n{_json_for_prompt(previous_chapter.model_dump())}"
            )
        if regeneration is not None:
            current = regeneration.content.model_dump(exclude_none=True)
            current["writingPlan"] = [
                {"title": item.title, "content": item.content}
                for item in regeneration.content.writingPlan
            ]
            sections.extend(
                [
                    f"作者当前页章纲（可能尚未编辑完整）：\n{_json_for_prompt(current)}",
                    f"本次修改意见：\n{regeneration.instructions}",
                ]
            )
        sections.append(
            f"请生成第 {chapter} 章的完整章纲，供作者审阅；只规划当前章，不生成其他章节。"
        )
        prompt = "\n\n".join(sections)
        actual = utf16_length(system) + utf16_length(prompt)
        if actual > 400_000:
            raise KnownError(
                "input-budget-exceeded",
                "assembled beat context exceeds budget",
                input_budget={
                    "limit": 400_000,
                    "actualLength": actual,
                    "systemChars": utf16_length(system),
                    "outlineChars": utf16_length(outline_json),
                    "settingChars": utf16_length(setting_json),
                    "previousChapterChars": utf16_length(
                        _json_for_prompt(previous_chapter.model_dump())
                    )
                    if previous_chapter is not None
                    else 0,
                    "draftChars": utf16_length(
                        _json_for_prompt(regeneration.content.model_dump(exclude_none=True))
                    )
                    if regeneration is not None
                    else 0,
                    "instructionsChars": utf16_length(regeneration.instructions)
                    if regeneration is not None
                    else 0,
                },
            )
        raw = cast(
            BeatDraft,
            await self.runtime.call_llm(
                output_type=BeatDraft,
                system=system,
                prompt=prompt,
                config=config,
                work_id=work_id,
                step_id="beat",
                chapter=chapter,
                request_id=request_id,
                attempt_id=f"{work_id}-beat-{chapter}-{uuid4()}",
                max_output_tokens=8000,
                max_retries=0,
                recorder=recorder,
            ),
        )
        return assign_beat_ids(raw)
