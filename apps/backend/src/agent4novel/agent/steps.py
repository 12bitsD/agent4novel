import json
import time
from importlib import resources
from typing import cast

from pydantic import Field

from ..contracts import StrictModel
from ..domain.work import (
    AgentConfig,
    CaptionContent,
    CreativeContent,
    CreativeDraftPack,
    CreativePack,
)
from ..errors import KnownError
from ..text import utf16_length, utf16_slice
from .recording import InvocationRecorder
from .runtime import ModelRuntime

SEED_CHAR_BUDGET = 100_000
AUTHOR_SYSTEM_CHAR_BUDGET = 48_000
_skill_cache: dict[str, str] = {}


def truncate_seed(seed: str) -> str:
    return utf16_slice(seed, 0, SEED_CHAR_BUDGET)


def load_skill(step_id: str) -> str:
    if step_id not in _skill_cache:
        _skill_cache[step_id] = (
            resources.files("agent4novel")
            .joinpath("skills", step_id, "SKILL.md")
            .read_text(encoding="utf-8")
        )
    return _skill_cache[step_id]


def system_for(step_id: str, config: AgentConfig, override: str | None = None) -> str:
    base = override if override is not None else load_skill(step_id)
    system = (
        f"{base}\n\nAuthor writing guidance (output contracts still apply):\n{config.systemPrompt}"
        if config.systemPrompt
        else base
    )
    if config.configRevision is not None and utf16_length(system) > AUTHOR_SYSTEM_CHAR_BUDGET:
        raise KnownError("config-invalid", "assembled author system context exceeds budget")
    return system


def _json_for_prompt(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


class CreativeRegeneration(StrictModel):
    content: CreativeContent | None
    instructions: str = Field(max_length=4000)


class CreativeLlmOutput(StrictModel):
    directions: list[CreativeDraftPack] = Field(min_length=1, max_length=3)


class CaptionStep:
    def __init__(self, runtime: ModelRuntime, *, system_prompt: str | None = None) -> None:
        self.runtime = runtime
        self.system_prompt = system_prompt

    async def run(
        self,
        *,
        work_id: str,
        seed: str,
        config: AgentConfig,
        request_id: str | None = None,
        recorder: InvocationRecorder | None = None,
    ) -> CaptionContent:
        prompt = f"作者原始素材:\n{truncate_seed(seed)}\n\n请输出提炼稿。"
        return cast(
            CaptionContent,
            await self.runtime.call_llm(
                output_type=CaptionContent,
                system=system_for("caption", config, self.system_prompt),
                prompt=prompt,
                config=config,
                work_id=work_id,
                step_id="caption",
                request_id=request_id,
                recorder=recorder,
                attempt_id=f"{work_id}-caption-{int(time.time() * 1000)}",
            ),
        )


class CreativeStep:
    def __init__(self, runtime: ModelRuntime, *, system_prompt: str | None = None) -> None:
        self.runtime = runtime
        self.system_prompt = system_prompt

    async def run(
        self,
        *,
        work_id: str,
        seed: str,
        caption: CaptionContent,
        config: AgentConfig,
        regeneration: CreativeRegeneration | None = None,
        request_id: str | None = None,
        recorder: InvocationRecorder | None = None,
    ) -> CreativeContent:
        count = config.directionCount or 2
        sections = [
            f"作者原始素材:\n{truncate_seed(seed)}",
            f"素材提炼稿:\n{_json_for_prompt(caption.model_dump())}",
        ]
        if regeneration is not None:
            content = regeneration.content.model_dump() if regeneration.content else None
            sections.extend(
                [
                    f"当前已保存方向包(仅供本次再生参考):\n{_json_for_prompt(content)}",
                    f"作者补充想法:\n{regeneration.instructions}",
                ]
            )
        sections.append(f"请产出 {count} 个差异化的创作方向(创意稿)。")
        attempt_id = f"{work_id}-creative-{int(time.time() * 1000)}"
        raw = cast(
            CreativeLlmOutput,
            await self.runtime.call_llm(
                output_type=CreativeLlmOutput,
                system=system_for("creative", config, self.system_prompt),
                prompt="\n\n".join(sections),
                config=config,
                work_id=work_id,
                step_id="creative",
                request_id=request_id,
                recorder=recorder,
                direction_count=count,
                attempt_id=attempt_id,
            ),
        )
        if len(raw.directions) != count:
            raise KnownError(
                "llm-invalid-output",
                f"expected {count} directions, got {len(raw.directions)}",
                retryable=True,
                attempt_id=attempt_id,
            )
        return CreativeContent(
            directions=[
                CreativePack.model_validate(
                    {
                        **direction.model_dump(),
                        "directionId": f"{work_id}-dir-{index + 1}",
                    }
                )
                for index, direction in enumerate(raw.directions)
            ]
        )
