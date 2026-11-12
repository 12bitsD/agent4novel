from typing import cast
from uuid import uuid4

from pydantic import Field

from ..contracts import StrictModel
from ..domain.work import (
    AgentConfig,
    BeatContent,
    PreviousChapter,
    ProseContent,
    ProseEditDraft,
    SettingContent,
)
from ..errors import KnownError
from ..text import utf16_length
from .recording import InvocationRecorder
from .runtime import ModelRuntime
from .steps import _json_for_prompt, system_for


class ProseRegeneration(StrictModel):
    content: ProseEditDraft
    instructions: str = Field(max_length=10_000)


class ProseStep:
    def __init__(self, runtime: ModelRuntime, *, system_prompt: str | None = None) -> None:
        self.runtime = runtime
        self.system_prompt = system_prompt

    async def run(
        self,
        *,
        work_id: str,
        seed: str,
        chapter: int,
        beat: BeatContent,
        setting: SettingContent,
        config: AgentConfig,
        regeneration: ProseRegeneration | None = None,
        previous_chapter: PreviousChapter | None = None,
        request_id: str | None = None,
        recorder: InvocationRecorder | None = None,
    ) -> ProseContent:
        if chapter < 1:
            raise KnownError("invalid-input", "invalid chapter")
        if (chapter == 1 and previous_chapter is not None) or (
            chapter > 1 and (previous_chapter is None or previous_chapter.chapter != chapter - 1)
        ):
            raise KnownError(
                "invalid-input",
                "previousChapter must match chapter - 1 and must be absent for chapter 1",
            )
        system = system_for("prose", config, self.system_prompt)
        beat_json = _json_for_prompt(beat.model_dump())
        setting_json = _json_for_prompt(setting.model_dump())
        sections = [
            f"模式：{'regenerate' if regeneration else 'initial'}；当前章号：{chapter}",
            f"完整已通过章纲：\n{beat_json}",
            f"完整已通过设定：\n{setting_json}",
        ]
        if previous_chapter is not None:
            sections.append(
                f"完整已通过上一章（实际正文优先于章纲计划）：\n{_json_for_prompt(previous_chapter.model_dump())}"
            )
        if regeneration is not None:
            sections.extend(
                [
                    f"作者当前编辑的正文：\n{_json_for_prompt(regeneration.content.model_dump())}",
                    f"本次修改意见：\n{regeneration.instructions}",
                ]
            )
        sections.append(
            f"请返回第 {chapter} 章完整正文，供作者独立把关。"
            f"保持章纲方向及章末落点，不提前续写第 {chapter + 1} 章。"
        )
        prompt = "\n\n".join(sections)
        actual = utf16_length(system) + utf16_length(prompt)
        if actual > 400_000:
            raise KnownError(
                "input-budget-exceeded",
                "assembled prose context exceeds budget",
                input_budget={
                    "limit": 400_000,
                    "actualLength": actual,
                    "systemChars": utf16_length(system),
                    "beatChars": utf16_length(beat_json),
                    "settingChars": utf16_length(setting_json),
                    "previousChapterChars": utf16_length(
                        _json_for_prompt(previous_chapter.model_dump())
                    )
                    if previous_chapter is not None
                    else 0,
                    "draftChars": utf16_length(_json_for_prompt(regeneration.content.model_dump()))
                    if regeneration is not None
                    else 0,
                    "instructionsChars": utf16_length(regeneration.instructions)
                    if regeneration is not None
                    else 0,
                },
            )
        return cast(
            ProseContent,
            await self.runtime.call_llm(
                output_type=ProseContent,
                system=system,
                prompt=prompt,
                config=config,
                work_id=work_id,
                step_id="prose",
                chapter=chapter,
                request_id=request_id,
                attempt_id=f"{work_id}-prose-{chapter}-{uuid4()}",
                max_output_tokens=16000,
                max_retries=0,
                recorder=recorder,
            ),
        )
