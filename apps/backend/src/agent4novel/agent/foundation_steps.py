import time
from typing import Any, cast
from uuid import uuid4

from pydantic import Field, model_validator

from ..contracts import StrictModel, TrimmedModel
from ..domain.drafts import SettingReviewDraft
from ..domain.work import (
    AgentConfig,
    CaptionContent,
    CreativeContent,
    OutlineContent,
)
from ..errors import KnownError
from ..services.review_content import assign_setting_ids
from .recording import InvocationRecorder
from .runtime import ModelRuntime
from .steps import _json_for_prompt, system_for, truncate_seed


class OutlineLlmSegment(TrimmedModel):
    title: str = Field(min_length=1, max_length=30)
    summary: str = Field(min_length=1, max_length=500)
    outcome: str = Field(min_length=1, max_length=500)


class OutlineLlmArc(TrimmedModel):
    title: str = Field(min_length=1, max_length=30)
    conflict: str = Field(min_length=1, max_length=500)
    development: str = Field(min_length=1, max_length=500)
    resolution: str = Field(min_length=1, max_length=500)
    segments: list[OutlineLlmSegment] = Field(min_length=2, max_length=8)


class OutlineLlmOutput(StrictModel):
    arcs: list[OutlineLlmArc] = Field(min_length=3, max_length=8)


class SettingDraft(SettingReviewDraft):
    @model_validator(mode="before")
    @classmethod
    def model_cannot_supply_ids(cls, value: Any) -> Any:
        if isinstance(value, dict):
            for column in ("world", "characters", "factions", "relationships"):
                if any("itemId" in item for item in value.get(column, [])):
                    raise ValueError("model IDs are assigned by the server")
            for section in value.get("extensions", []):
                if "sectionId" in section or any(
                    "itemId" in item for item in section.get("items", [])
                ):
                    raise ValueError("model IDs are assigned by the server")
        return value


class OutlineStep:
    def __init__(self, runtime: ModelRuntime, *, system_prompt: str | None = None) -> None:
        self.runtime = runtime
        self.system_prompt = system_prompt

    async def run(
        self,
        *,
        work_id: str,
        seed: str,
        creative: CreativeContent,
        config: AgentConfig,
        request_id: str | None = None,
        recorder: InvocationRecorder | None = None,
    ) -> OutlineContent:
        if len(creative.directions) != 1:
            raise KnownError("direction-not-selected", "creative must hold exactly 1 direction")
        attempt_id = f"{work_id}-outline-{int(time.time() * 1000)}"
        prompt = "\n\n".join(
            [
                f"作者原始素材:\n{truncate_seed(seed)}",
                f"选定创作方向(创意稿):\n{_json_for_prompt(creative.directions[0].model_dump())}",
                "请产出全书大纲(弧线 + 剧情点两层结构)。",
            ]
        )
        raw = cast(
            OutlineLlmOutput,
            await self.runtime.call_llm(
                output_type=OutlineLlmOutput,
                system=system_for("outline", config, self.system_prompt),
                prompt=prompt,
                config=config,
                work_id=work_id,
                step_id="outline",
                request_id=request_id,
                attempt_id=attempt_id,
                max_output_tokens=16000,
                recorder=recorder,
            ),
        )
        arcs = []
        for arc_index, arc in enumerate(raw.arcs, start=1):
            arc_id = f"{work_id}-arc-{arc_index}"
            arcs.append(
                {
                    **arc.model_dump(),
                    "arcId": arc_id,
                    "segments": [
                        {**segment.model_dump(), "segmentId": f"{arc_id}-seg-{segment_index}"}
                        for segment_index, segment in enumerate(arc.segments, start=1)
                    ],
                }
            )
        return OutlineContent.model_validate({"arcs": arcs})


class SettingStep:
    def __init__(self, runtime: ModelRuntime, *, system_prompt: str | None = None) -> None:
        self.runtime = runtime
        self.system_prompt = system_prompt

    async def run(
        self,
        *,
        work_id: str,
        seed: str,
        caption: CaptionContent,
        creative: CreativeContent,
        outline: OutlineContent,
        config: AgentConfig,
        request_id: str | None = None,
        recorder: InvocationRecorder | None = None,
    ) -> Any:
        if len(creative.directions) != 1:
            raise KnownError("direction-not-selected", "creative must hold exactly 1 direction")
        prompt = "\n\n".join(
            [
                f"作者原始素材:\n{truncate_seed(seed)}",
                f"素材提炼稿:\n{_json_for_prompt(caption.model_dump())}",
                f"选定创作方向(创意稿):\n{_json_for_prompt(creative.directions[0].model_dump())}",
                f"已通过大纲:\n{_json_for_prompt(outline.model_dump())}",
                "请整份产出完整设定，供作者编辑并通过。",
            ]
        )
        raw = cast(
            SettingDraft,
            await self.runtime.call_llm(
                output_type=SettingDraft,
                system=system_for("setting", config, self.system_prompt),
                prompt=prompt,
                config=config,
                work_id=work_id,
                step_id="setting",
                request_id=request_id,
                attempt_id=f"{work_id}-setting-{uuid4()}",
                max_output_tokens=16000,
                max_retries=0,
                recorder=recorder,
            ),
        )
        return assign_setting_ids(raw)
