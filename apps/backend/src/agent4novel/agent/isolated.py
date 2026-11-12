import asyncio
from typing import Any, Literal, Self, cast
from uuid import uuid4

from pydantic import Field, ValidationError, field_validator, model_validator

from ..config import ModelConfigError, parse_model_id
from ..contracts import StrictModel, is_absent
from ..domain.work import (
    AgentConfig,
    BeatContent,
    CaptionContent,
    CreativeContent,
    OutlineContent,
    PreviousChapter,
    SettingContent,
)
from ..errors import KnownError
from ..text import utf16_length
from .chapter_steps import BeatRegeneration, BeatStep
from .foundation_steps import OutlineStep, SettingStep
from .prose_steps import ProseRegeneration, ProseStep
from .recording import StepRecorder
from .runtime import ModelRuntime
from .steps import CaptionStep, CreativeRegeneration, CreativeStep

STEP_IDS = ("caption", "creative", "outline", "setting", "beat", "prose")


class ExperimentConfig(StrictModel):
    model: str | None = Field(default=None, exclude_if=is_absent)
    directionCount: int | None = Field(default=None, exclude_if=is_absent, ge=1, le=3)
    thinking: Literal["enabled", "disabled"] | None = Field(default=None, exclude_if=is_absent)
    temperature: float | None = Field(default=None, exclude_if=is_absent, ge=0, le=1)
    topP: float | None = Field(default=None, exclude_if=is_absent, gt=0, le=1)


class ExperimentInput(StrictModel):
    seed: str
    upstream: dict[str, Any] | None = Field(default=None, exclude_if=is_absent)
    chapter: int | None = Field(default=None, exclude_if=is_absent, gt=0, le=9_007_199_254_740_991)
    regeneration: CreativeRegeneration | BeatRegeneration | ProseRegeneration | None = Field(
        default=None, exclude_if=is_absent
    )

    @field_validator("seed")
    @classmethod
    def seed_within_budget(cls, value: str) -> str:
        if utf16_length(value) > 100_000:
            raise ValueError("seed exceeds budget")
        return value


class ExperimentSources(StrictModel):
    input: Literal["input-file", "seed-file"]
    inputPath: str | None
    systemPromptPath: str | None
    configPath: str | None


class ExperimentVersion(StrictModel):
    gitCommit: str | None
    gitDirty: bool | None


class ExperimentRecord(StrictModel):
    dir: str = Field(min_length=1, max_length=4096)
    sources: ExperimentSources
    version: ExperimentVersion


class StepExperimentRequest(StrictModel):
    stepId: Literal["caption", "creative", "outline", "setting", "beat", "prose"]
    input: ExperimentInput
    systemPrompt: str | None = Field(default=None, exclude_if=is_absent, min_length=1)
    config: ExperimentConfig | None = Field(default=None, exclude_if=is_absent)
    record: ExperimentRecord | None = Field(default=None, exclude_if=is_absent)

    @field_validator("systemPrompt")
    @classmethod
    def valid_system_prompt(cls, value: str | None) -> str | None:
        if value is not None and (not value.strip() or utf16_length(value) > 100_000):
            raise ValueError("invalid system prompt")
        return value

    @model_validator(mode="after")
    def selected_step_input(self) -> Self:
        chapter_step = self.stepId in {"beat", "prose"}
        if chapter_step != (self.input.chapter is not None):
            raise ValueError("chapter requires a supported chapter step")
        expected_regeneration = {
            "creative": CreativeRegeneration,
            "beat": BeatRegeneration,
            "prose": ProseRegeneration,
        }.get(self.stepId)
        if self.input.regeneration is not None and (
            expected_regeneration is None
            or not isinstance(self.input.regeneration, expected_regeneration)
        ):
            raise ValueError("regeneration content must match the selected step")
        if chapter_step:
            previous = (self.input.upstream or {}).get("previousChapter")
            assert self.input.chapter is not None
            if (self.input.chapter == 1 and previous is not None) or (
                self.input.chapter > 1
                and (
                    previous is None
                    or PreviousChapter.model_validate(previous).chapter != self.input.chapter - 1
                )
            ):
                raise ValueError("previousChapter must match chapter - 1")
        return self


def _previous(request: StepExperimentRequest) -> PreviousChapter | None:
    value = (request.input.upstream or {}).get("previousChapter")
    return PreviousChapter.model_validate(value) if value is not None else None


def _selected_creative(value: Any) -> CreativeContent:
    creative = CreativeContent.model_validate(value)
    if len(creative.directions) != 1:
        raise KnownError(
            "direction-not-selected",
            f"creative must hold exactly 1 direction, got {len(creative.directions)}",
        )
    return creative


def _telemetry(runtime: ModelRuntime, run_id: str) -> list[dict[str, Any]]:
    return [entry.model_dump(mode="json") for entry in runtime.telemetry.telemetry_for(run_id)]


async def run_isolated_step(
    request: Any,
    runtime: ModelRuntime,
    *,
    cancel_event: asyncio.Event | None = None,
) -> dict[str, Any]:
    run_id = f"experiment-{uuid4()}"
    try:
        selected_model = request.get("config", {}).get("model") or runtime.default_model_id
    except AttributeError:
        selected_model = runtime.default_model_id
    try:
        model = parse_model_id(selected_model)
    except ModelConfigError:
        model = "unrecognized-model"
    base: dict[str, Any] = {
        "runId": run_id,
        "stepId": None,
        "executionMode": "live",
        "model": model,
    }
    recorder: StepRecorder | None = None
    parsed: StepExperimentRequest | None = None
    try:
        parsed = StepExperimentRequest.model_validate(request)
        base["stepId"] = parsed.stepId
        if parsed.record is not None:
            recorder = StepRecorder.start(parsed.record, parsed.input, run_id, parsed.stepId, model)
        if runtime.mode != "live":
            raise KnownError("llm-unavailable", "Live model configuration required")
        config = AgentConfig.model_validate(
            parsed.config.model_dump(exclude_none=True) if parsed.config else {}
        )
        seed = parsed.input.seed
        upstream = parsed.input.upstream or {}
        content: Any
        if parsed.stepId == "caption":
            content = await CaptionStep(runtime, system_prompt=parsed.systemPrompt).run(
                work_id=run_id, seed=seed, config=config, recorder=recorder
            )
        elif parsed.stepId == "creative":
            content = await CreativeStep(runtime, system_prompt=parsed.systemPrompt).run(
                work_id=run_id,
                seed=seed,
                caption=CaptionContent.model_validate(upstream.get("caption")),
                config=config,
                regeneration=cast(CreativeRegeneration | None, parsed.input.regeneration),
                recorder=recorder,
            )
        elif parsed.stepId == "outline":
            content = await OutlineStep(runtime, system_prompt=parsed.systemPrompt).run(
                work_id=run_id,
                seed=seed,
                creative=_selected_creative(upstream.get("creative")),
                config=config,
                recorder=recorder,
            )
        elif parsed.stepId == "setting":
            content = await SettingStep(runtime, system_prompt=parsed.systemPrompt).run(
                work_id=run_id,
                seed=seed,
                caption=CaptionContent.model_validate(upstream.get("caption")),
                creative=_selected_creative(upstream.get("creative")),
                outline=OutlineContent.model_validate(upstream.get("outline")),
                config=config,
                recorder=recorder,
            )
        else:
            assert parsed.input.chapter is not None
            previous = _previous(parsed)
            if parsed.stepId == "beat":
                content = await BeatStep(runtime, system_prompt=parsed.systemPrompt).run(
                    work_id=run_id,
                    seed=seed,
                    chapter=parsed.input.chapter,
                    outline=OutlineContent.model_validate(upstream.get("outline")),
                    setting=SettingContent.model_validate(upstream.get("setting")),
                    config=config,
                    regeneration=cast(BeatRegeneration | None, parsed.input.regeneration),
                    previous_chapter=previous,
                    recorder=recorder,
                )
            else:
                content = await ProseStep(runtime, system_prompt=parsed.systemPrompt).run(
                    work_id=run_id,
                    seed=seed,
                    chapter=parsed.input.chapter,
                    beat=BeatContent.model_validate(upstream.get("beat")),
                    setting=SettingContent.model_validate(upstream.get("setting")),
                    config=config,
                    regeneration=cast(ProseRegeneration | None, parsed.input.regeneration),
                    previous_chapter=previous,
                    recorder=recorder,
                )
        if cancel_event is not None and cancel_event.is_set():
            raise asyncio.CancelledError from None
        result = {
            **base,
            "kind": "succeeded",
            "content": content.model_dump(mode="json"),
            "telemetry": _telemetry(runtime, run_id),
        }
        if recorder is not None:
            result["recording"] = recorder.finish(
                status="succeeded",
                content=result["content"],
                code=None,
                retryable=None,
                telemetry=result["telemetry"],
            )
        return result
    except Exception as error:
        if cancel_event is not None and cancel_event.is_set():
            raise asyncio.CancelledError from None
        if isinstance(error, ValidationError):
            code = "invalid-input"
        elif isinstance(error, KnownError):
            code = error.code
        elif hasattr(error, "code") and error.code == "recording-failed":
            code = "recording-failed"
        else:
            code = "step-failed"
        retryable = error.retryable if isinstance(error, KnownError) else False
        result = {
            **base,
            "kind": "failed",
            "code": code,
            "retryable": retryable,
            "telemetry": _telemetry(runtime, run_id),
        }
        if recorder is not None:
            result["recording"] = recorder.finish(
                status="failed",
                content=None,
                code=code,
                retryable=retryable,
                telemetry=result["telemetry"],
            )
        elif parsed is not None and parsed.record is not None:
            result["recording"] = {
                "status": "failed",
                "dir": parsed.record.dir,
                "error": getattr(error, "reason", "recording-not-prepared"),
            }
        return result
