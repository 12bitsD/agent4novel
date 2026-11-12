from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from .agent.chapter_steps import BeatRegeneration, BeatStep
from .agent.fake_steps import (
    fake_beat,
    fake_caption,
    fake_creative,
    fake_outline,
    fake_prose,
    fake_setting,
)
from .agent.foundation_steps import OutlineStep, SettingStep
from .agent.prose_steps import ProseRegeneration, ProseStep
from .agent.runtime import ModelRuntime
from .agent.steps import CaptionStep, CreativeRegeneration, CreativeStep
from .domain.commands import (
    BeatCommandObservation,
    BeatExecutionObservation,
    BeatHead,
    ProseCommandObservation,
    ProseExecutionObservation,
    ProseHead,
)
from .domain.drafts import BeatReviewDraft
from .domain.requests import (
    ApproveRequest,
    BeatApproveRequest,
    BeatRegenerateRequest,
    BeatVariantSelectionRequest,
    CreativeRegenerateRequest,
    OutlineApprovalRequest,
    OutlineDraftRequest,
    ProseApproveRequest,
    ProseRegenerateRequest,
    ProseSaveRequest,
    SettingApproveRequest,
    StartChapterRequest,
)
from .domain.work import (
    AgentConfig,
    Artifact,
    ArtifactInput,
    CreativeContent,
    PreviousChapter,
    Work,
    WorkDetail,
)
from .errors import KnownError
from .pipeline import Pipeline, PipelineDefinitionEntry, chapter_summaries, current_chapter_of
from .services.author_config import AuthorConfigService
from .services.beat_review import prepare_beat_review
from .services.command_runtime import (
    BeatCommandError,
    BeatExecution,
    CommandScope,
    ProseCommandError,
    ProseExecution,
    beat_failure_code,
    observe_beat,
    observe_prose,
    prose_failure_code,
)
from .services.prose_review import prepare_prose_review
from .services.review_content import (
    assert_beat_ids,
    assign_beat_ids,
    assign_setting_ids,
    normalize_outline_ids,
)
from .store.work import ArtifactHead, ArtifactPrecondition


class GenerationPipeline(Pipeline):
    def __init__(
        self,
        store: Any,
        *,
        runtime: ModelRuntime | None = None,
        author_config: AuthorConfigService | None = None,
    ) -> None:
        super().__init__(store, repeat_chapters=True)
        self.runtime = runtime or ModelRuntime({}, telemetry=self.telemetry)
        self.telemetry = self.runtime.telemetry
        self.author_config = author_config
        self.caption_step = CaptionStep(self.runtime)
        self.creative_step = CreativeStep(self.runtime)
        self.outline_step = OutlineStep(self.runtime)
        self.setting_step = SettingStep(self.runtime)
        self.beat_step = BeatStep(self.runtime)
        self.prose_step = ProseStep(self.runtime)
        self._advancing: set[str] = set()
        self._failures: dict[str, dict[str, Any]] = {}

    @contextmanager
    def _generation_lock(self, work_id: str) -> Iterator[None]:
        if work_id in self._advancing:
            raise KnownError(
                "advance-in-progress", f"advance already running: {work_id}", retryable=True
            )
        self._advancing.add(work_id)
        try:
            yield
        finally:
            self._advancing.remove(work_id)

    def create_work(self, seed: str, title: str | None = None) -> Work:
        return self.store.create_work(seed, title)

    def get_state(self, work_id: str) -> Any:
        if self.store.get_work(work_id) is None:
            raise KnownError("work-not-found", f"work not found: {work_id}")
        return super().get_state(work_id)

    def failure_of(self, work_id: str) -> dict[str, Any] | None:
        return self._failures.get(work_id)

    def _operation_configs(self, work_id: str) -> dict[str, AgentConfig]:
        work = self.store.get_work(work_id)
        if work is None:
            raise KnownError("work-not-found", "work not found")
        if self.author_config is not None:
            return self.author_config.snapshot(work)
        return {entry.stepId: work.config.model_copy(deep=True) for entry in self.definition}

    def _inputs_for(
        self, work: WorkDetail, entry: PipelineDefinitionEntry
    ) -> tuple[
        dict[str, Any],
        list[ArtifactInput],
        list[ArtifactPrecondition],
        PreviousChapter | None,
    ]:
        upstream: dict[str, Any] = {}
        inputs: list[ArtifactInput] = []
        preconditions: list[ArtifactPrecondition] = []
        for kind in entry.consumes:
            chapter = self.dependency_chapter(entry, kind)
            artifact = next(
                (item for item in work.artifacts if item.kind == kind and item.chapter == chapter),
                None,
            )
            if artifact is None or artifact.humanStatus != "approved":
                raise KnownError("upstream-changed", "input is no longer approved")
            if kind == "creative" and len(artifact.content.directions) != 1:
                raise KnownError("direction-not-selected", "creative must hold exactly 1 direction")
            upstream[kind] = artifact.content.model_dump(mode="json")
            inputs.append(
                ArtifactInput(
                    kind=kind,
                    **({} if chapter is None else {"chapter": chapter}),
                    artifactId=artifact.id,
                    version=artifact.version,
                )
            )
            preconditions.append(
                ArtifactPrecondition(
                    kind=kind,
                    **({} if chapter is None else {"chapter": chapter}),
                    head=ArtifactHead(
                        artifactId=artifact.id,
                        version=artifact.version,
                        humanStatus="approved",
                    ),
                )
            )
        previous = None
        if entry.chapter is not None and entry.chapter > 1:
            previous_beat = next(
                (
                    item
                    for item in work.artifacts
                    if item.kind == "beat" and item.chapter == entry.chapter - 1
                ),
                None,
            )
            previous_prose = next(
                (
                    item
                    for item in work.artifacts
                    if item.kind == "prose" and item.chapter == entry.chapter - 1
                ),
                None,
            )
            if (
                previous_beat is None
                or previous_beat.humanStatus != "approved"
                or previous_prose is None
                or previous_prose.humanStatus != "approved"
            ):
                raise KnownError("chapter-not-ready", "previous chapter must be approved")
            previous = PreviousChapter(
                chapter=entry.chapter - 1,
                beat=previous_beat.content,
                prose=previous_prose.content,
            )
            upstream["previousChapter"] = previous.model_dump(mode="json")
            for artifact in (previous_beat, previous_prose):
                inputs.append(
                    ArtifactInput(
                        kind=artifact.kind,
                        chapter=artifact.chapter,
                        artifactId=artifact.id,
                        version=artifact.version,
                    )
                )
                preconditions.append(
                    ArtifactPrecondition(
                        kind=artifact.kind,
                        chapter=artifact.chapter,
                        head=ArtifactHead(
                            artifactId=artifact.id,
                            version=artifact.version,
                            humanStatus="approved",
                        ),
                    )
                )
        return upstream, inputs, preconditions, previous

    async def _execute_entry(
        self,
        work_id: str,
        entry: PipelineDefinitionEntry,
        configs: dict[str, AgentConfig],
        *,
        regeneration: CreativeRegeneration | None = None,
        baseline: Artifact | None = None,
        request_id: str | None = None,
        beat_regeneration: BeatRegeneration | None = None,
        prose_regeneration: ProseRegeneration | None = None,
        additional_preconditions: list[ArtifactPrecondition] | None = None,
        execution: BeatExecution | ProseExecution | None = None,
    ) -> Artifact:
        work = self.store.get_work(work_id)
        if work is None:
            raise KnownError("work-not-found", "work not found")
        _, inputs, preconditions, previous_chapter = self._inputs_for(work, entry)
        if entry.outputKind in {"beat", "prose"}:
            current_index = next(
                index for index, item in enumerate(self.definition) if item.stepId == entry.stepId
            )
            for prior in self.definition_for(entry.chapter or 1)[:current_index]:
                head = next(
                    (
                        item
                        for item in work.artifacts
                        if item.kind == prior.outputKind and item.chapter == prior.chapter
                    ),
                    None,
                )
                if (
                    head is None
                    or head.humanStatus != "approved"
                    or (head.kind == "creative" and len(head.content.directions) != 1)
                ):
                    code = (
                        "beat-gate-not-ready"
                        if entry.outputKind == "beat"
                        else "prose-gate-not-ready"
                    )
                    raise KnownError(code, "earlier gate not ready")
                if not any(
                    condition.kind == head.kind and condition.chapter == head.chapter
                    for condition in preconditions
                ):
                    preconditions.append(
                        ArtifactPrecondition(
                            kind=head.kind,
                            **({} if head.chapter is None else {"chapter": head.chapter}),
                            head=ArtifactHead(
                                artifactId=head.id,
                                version=head.version,
                                humanStatus="approved",
                            ),
                        )
                    )
        target = ArtifactPrecondition(
            kind=entry.outputKind,
            **({} if entry.chapter is None else {"chapter": entry.chapter}),
            head=None
            if baseline is None
            else ArtifactHead(
                artifactId=baseline.id,
                version=baseline.version,
                humanStatus=baseline.humanStatus,
            ),
        )
        config = configs[entry.stepId]
        if execution is not None:
            execution.stage = "model"
        content: Any
        if entry.stepId == "caption":
            content = (
                fake_caption(work.seed)
                if self.runtime.mode == "demo"
                else await self.caption_step.run(
                    work_id=work_id, seed=work.seed, config=config, request_id=request_id
                )
            )
        elif entry.stepId == "creative":
            caption = next(item for item in work.artifacts if item.kind == "caption")
            content = (
                fake_creative(work_id, work.seed, config)
                if self.runtime.mode == "demo"
                else await self.creative_step.run(
                    work_id=work_id,
                    seed=work.seed,
                    caption=caption.content,
                    config=config,
                    regeneration=regeneration,
                    request_id=request_id,
                )
            )
        elif entry.stepId == "outline":
            creative = next(item for item in work.artifacts if item.kind == "creative")
            content = (
                fake_outline(work_id, work.seed)
                if self.runtime.mode == "demo"
                else await self.outline_step.run(
                    work_id=work_id,
                    seed=work.seed,
                    creative=creative.content,
                    config=config,
                    request_id=request_id,
                )
            )
        elif entry.stepId == "setting":
            caption = next(item for item in work.artifacts if item.kind == "caption")
            creative = next(item for item in work.artifacts if item.kind == "creative")
            outline = next(item for item in work.artifacts if item.kind == "outline")
            content = (
                fake_setting(work_id, work.seed, creative.content)
                if self.runtime.mode == "demo"
                else await self.setting_step.run(
                    work_id=work_id,
                    seed=work.seed,
                    caption=caption.content,
                    creative=creative.content,
                    outline=outline.content,
                    config=config,
                    request_id=request_id,
                )
            )
        elif entry.stepId == "beat":
            outline = next(item for item in work.artifacts if item.kind == "outline")
            setting = next(item for item in work.artifacts if item.kind == "setting")
            content = (
                fake_beat(
                    chapter=entry.chapter or 1,
                    outline=outline.content,
                    setting=setting.content,
                    regeneration=beat_regeneration,
                    previous_chapter=previous_chapter,
                )
                if self.runtime.mode == "demo"
                else await self.beat_step.run(
                    work_id=work_id,
                    seed=work.seed,
                    chapter=entry.chapter or 1,
                    outline=outline.content,
                    setting=setting.content,
                    config=config,
                    regeneration=beat_regeneration,
                    previous_chapter=previous_chapter,
                    request_id=request_id,
                )
            )
            if beat_regeneration is not None and baseline is not None:
                generated = content.model_dump()
                generated["writingPlan"] = [
                    {"title": item.title, "content": item.content} for item in content.writingPlan
                ]
                content = assign_beat_ids(
                    BeatReviewDraft.model_validate(generated), baseline.content
                )
        elif entry.stepId == "prose":
            beat = next(
                item
                for item in work.artifacts
                if item.kind == "beat" and item.chapter == entry.chapter
            )
            setting = next(item for item in work.artifacts if item.kind == "setting")
            content = (
                fake_prose(
                    beat=beat.content,
                    setting=setting.content,
                    regeneration=prose_regeneration,
                    previous_chapter=previous_chapter,
                )
                if self.runtime.mode == "demo"
                else await self.prose_step.run(
                    work_id=work_id,
                    seed=work.seed,
                    chapter=entry.chapter or 1,
                    beat=beat.content,
                    setting=setting.content,
                    config=config,
                    regeneration=prose_regeneration,
                    previous_chapter=previous_chapter,
                    request_id=request_id,
                )
            )
        else:
            raise KnownError("llm-unavailable", "step is not available", retryable=False)
        if execution is not None:
            execution.stage = "output"
        if execution is not None:
            execution.stage = "commit"
        return self.store.append_artifact(
            work_id,
            entry.outputKind,
            content,
            chapter=entry.chapter,
            human_status="pending" if entry.gateAfter else "approved",
            inputs=inputs,
            preconditions=[target, *preconditions, *(additional_preconditions or [])],
        )

    async def advance(
        self,
        work_id: str,
        *,
        request_id: str | None = None,
        telemetry_cursor: int | None = None,
    ) -> dict[str, Any]:
        scope = CommandScope.create(self.runtime, cursor=telemetry_cursor, request_id=request_id)
        with self._generation_lock(work_id):
            last_step: str | None = None
            configs: dict[str, AgentConfig] | None = None
            for _ in range(len(self.definition) + 1):
                state = self.get_state(work_id)
                if state.stage == "complete":
                    return {"kind": "complete", "state": state}
                if state.stage != "ready" or state.nextStepId is None:
                    return (
                        {"kind": "advanced", "stepId": last_step, "state": state}
                        if last_step
                        else {"kind": "awaiting-approval", "state": state}
                    )
                work = self.store.get_work(work_id)
                if work is None:
                    raise KnownError("work-not-found", f"work not found: {work_id}")
                entry = next(
                    item
                    for item in self.definition_for(current_chapter_of(work))
                    if item.stepId == state.nextStepId
                )
                beat_command: BeatCommandObservation | None = None
                prose_command: ProseCommandObservation | None = None
                try:
                    if configs is None:
                        configs = self._operation_configs(work_id)
                    if entry.stepId == "beat":

                        async def run_beat(
                            execution: BeatExecution,
                            entry: Any = entry,
                            configs: Any = configs,
                        ) -> Artifact:
                            return await self._execute_entry(
                                work_id, entry, configs, request_id=request_id, execution=execution
                            )

                        _, beat_command = await observe_beat(
                            work_id,
                            "generate-beat",
                            None,
                            run_beat,
                            buffer=self.telemetry,
                            scope=scope,
                            chapter=entry.chapter or 1,
                        )
                    elif entry.stepId == "prose":

                        async def run_prose(
                            execution: ProseExecution,
                            entry: Any = entry,
                            configs: Any = configs,
                        ) -> Artifact:
                            return await self._execute_entry(
                                work_id, entry, configs, request_id=request_id, execution=execution
                            )

                        _, prose_command = await observe_prose(
                            work_id,
                            "generate-prose",
                            None,
                            run_prose,
                            buffer=self.telemetry,
                            scope=scope,
                            chapter=entry.chapter or 1,
                        )
                    else:
                        await self._execute_entry(work_id, entry, configs, request_id=request_id)
                except Exception as error:
                    cause = (
                        error.cause
                        if isinstance(error, (BeatCommandError, ProseCommandError))
                        else error
                    )
                    known = cause if isinstance(cause, KnownError) else None
                    code = (
                        beat_failure_code(cause, error.command.failureStage or "response")
                        if isinstance(error, BeatCommandError)
                        else prose_failure_code(cause, error.command.failureStage or "response")
                        if isinstance(error, ProseCommandError)
                        else known.code
                        if known
                        else "llm-unavailable"
                    )
                    retryable = code == "upstream-changed" or (known.retryable if known else True)
                    self._failures[work_id] = {
                        "stepId": entry.stepId,
                        "code": code,
                        "retryable": retryable,
                    }
                    return {
                        "kind": "failed",
                        "stepId": entry.stepId,
                        "code": code,
                        "retryable": retryable,
                        **(
                            {"attemptId": known.attemptId}
                            if known is not None and known.attemptId is not None
                            else {}
                        ),
                        "state": self.get_state(work_id),
                        **(
                            {"beatCommand": error.command}
                            if isinstance(error, BeatCommandError)
                            else {"proseCommand": error.command}
                            if isinstance(error, ProseCommandError)
                            else {}
                        ),
                    }
                self._failures.pop(work_id, None)
                if entry.gateAfter:
                    return {
                        "kind": "advanced",
                        "stepId": entry.stepId,
                        "state": self.get_state(work_id),
                        **({"beatCommand": beat_command} if beat_command else {}),
                        **({"proseCommand": prose_command} if prose_command else {}),
                    }
                last_step = entry.stepId
            raise RuntimeError("advance loop exceeded definition length")

    def save_creative_draft(
        self, work_id: str, expected_version: int, content: CreativeContent
    ) -> Artifact:
        work = self.store.get_work(work_id)
        if work is None:
            raise KnownError("work-not-found", "not found")
        current = next((item for item in work.artifacts if item.kind == "creative"), None)
        if current is None or current.version != expected_version:
            raise KnownError("version-conflict", "artifact head changed")
        current_ids = {item.directionId for item in current.content.directions}
        submitted_ids = {item.directionId for item in content.directions}
        if len(submitted_ids) != len(current_ids) or submitted_ids != current_ids:
            raise KnownError("invalid-content", "direction ids must match the current head")
        return self.store.append_artifact(
            work_id,
            "creative",
            content,
            preconditions=[
                ArtifactPrecondition(
                    kind="creative",
                    head=ArtifactHead(
                        artifactId=current.id,
                        version=current.version,
                        humanStatus=current.humanStatus,
                    ),
                )
            ],
        )

    def select_creative(self, work_id: str, direction_id: str, expected_version: int) -> Artifact:
        work = self.store.get_work(work_id)
        if work is None:
            raise KnownError("work-not-found", "not found")
        current = next((item for item in work.artifacts if item.kind == "creative"), None)
        if current is None or current.version != expected_version:
            raise KnownError("version-conflict", "artifact head changed")
        direction = next(
            (item for item in current.content.directions if item.directionId == direction_id),
            None,
        )
        if direction is None:
            raise KnownError("direction-not-selected", f"direction not found: {direction_id}")
        artifact = self.store.append_artifact(
            work_id,
            "creative",
            CreativeContent(directions=[direction]),
            human_status="approved",
            preconditions=[
                ArtifactPrecondition(
                    kind="creative",
                    head=ArtifactHead(
                        artifactId=current.id,
                        version=current.version,
                        humanStatus=current.humanStatus,
                    ),
                )
            ],
        )
        self._failures.pop(work_id, None)
        return artifact

    async def regenerate_creative(
        self,
        work_id: str,
        request: CreativeRegenerateRequest,
        *,
        request_id: str | None = None,
    ) -> Artifact:
        with self._generation_lock(work_id):
            work = self.store.get_work(work_id)
            if work is None:
                raise KnownError("work-not-found", "work not found")
            baseline = next((item for item in work.artifacts if item.kind == "creative"), None)
            expected = (
                request.expectedArtifactId is not None and request.expectedHeadVersion is not None
            )
            if baseline is None and expected:
                raise KnownError("version-conflict", "creative target does not exist")
            if baseline is not None and (
                not expected
                or baseline.id != request.expectedArtifactId
                or baseline.version != request.expectedHeadVersion
            ):
                raise KnownError("version-conflict", "creative head changed")
            if baseline is not None and baseline.humanStatus == "approved":
                raise KnownError("artifact-already-approved", "creative is already approved")
            entry = next(item for item in self.definition if item.outputKind == "creative")
            configs = self._operation_configs(work_id)
            regeneration = CreativeRegeneration(
                content=baseline.content if baseline else None,
                instructions=request.instructions,
            )
            return await self._execute_entry(
                work_id,
                entry,
                configs,
                regeneration=regeneration,
                baseline=baseline,
                request_id=request_id,
            )

    def save_outline_draft(self, work_id: str, request: OutlineDraftRequest) -> Artifact:
        work = self.store.get_work(work_id)
        if work is None:
            raise KnownError("work-not-found", "not found")
        current = next((item for item in work.artifacts if item.kind == "outline"), None)
        if current is None or current.version != request.expectedHeadVersion:
            raise KnownError("version-conflict", "artifact head changed")
        content = normalize_outline_ids(work_id, request.content)
        return self.store.append_artifact(
            work_id,
            "outline",
            content,
            preconditions=[
                ArtifactPrecondition(
                    kind="outline",
                    head=ArtifactHead(
                        artifactId=current.id,
                        version=current.version,
                        humanStatus=current.humanStatus,
                    ),
                )
            ],
        )

    def approve_outline(self, work_id: str, request: OutlineApprovalRequest) -> Artifact:
        work = self.store.get_work(work_id)
        if work is None:
            raise KnownError("work-not-found", "work not found")
        head = next((item for item in work.artifacts if item.kind == "outline"), None)
        if head is None:
            raise KnownError("artifact-not-found", "outline not found")
        if head.id != request.expectedArtifactId or head.version != request.expectedHeadVersion:
            raise KnownError("version-conflict", "outline head changed")
        self.store.set_status(
            work_id,
            "outline",
            "approved",
            preconditions=[
                ArtifactPrecondition(
                    kind="outline",
                    head=ArtifactHead(
                        artifactId=head.id,
                        version=head.version,
                        humanStatus=head.humanStatus,
                    ),
                )
            ],
        )
        if head.humanStatus == "pending":
            self._failures.pop(work_id, None)
        return head.model_copy(update={"humanStatus": "approved"})

    def approve_setting(self, work_id: str, request: SettingApproveRequest) -> Artifact:
        work = self.store.get_work(work_id)
        if work is None:
            raise KnownError("work-not-found", "work not found")
        target = next((item for item in work.artifacts if item.kind == "setting"), None)
        if target is None:
            raise KnownError("artifact-not-found", "setting not found")
        if target.version != request.expectedHeadVersion:
            raise KnownError("version-conflict", "setting version changed")
        if target.humanStatus != "pending":
            raise KnownError("artifact-already-approved", "setting already approved")
        preconditions = []
        for kind in ("caption", "creative", "outline"):
            artifact = next((item for item in work.artifacts if item.kind == kind), None)
            if (
                artifact is None
                or artifact.humanStatus != "approved"
                or (kind == "creative" and len(artifact.content.directions) != 1)
            ):
                raise KnownError("setting-gate-not-ready", "approve the earlier gate first")
            preconditions.append(
                ArtifactPrecondition(
                    kind=kind,
                    head=ArtifactHead(
                        artifactId=artifact.id,
                        version=artifact.version,
                        humanStatus="approved",
                    ),
                )
            )
        content = assign_setting_ids(request.content, target.content)
        artifact = self.store.finalize_artifact(
            work_id,
            "setting",
            chapter=None,
            expected_artifact_id=target.id,
            expected_head_version=request.expectedHeadVersion,
            content=content,
            preconditions=preconditions,
        )
        self._failures.pop(work_id, None)
        return artifact

    def approve(self, work_id: str, request: ApproveRequest) -> Any:
        if request.kind == "creative":
            raise KnownError(
                "direction-not-selected",
                "creative must be approved via POST .../artifacts/creative/select",
            )
        if request.kind in {"beat", "prose", "setting"}:
            raise KnownError(
                f"{request.kind}-approval-required",
                f"{request.kind} must use its full-content approval command",
            )
        work = self.store.get_work(work_id)
        head = next(
            (
                item
                for item in (work.artifacts if work else [])
                if item.kind == request.kind and item.chapter == request.chapter
            ),
            None,
        )
        if head is None:
            raise KnownError("artifact-not-found", "artifact not found")
        self.store.set_status(
            work_id,
            request.kind,
            "approved",
            chapter=request.chapter,
            preconditions=[
                ArtifactPrecondition(
                    kind=request.kind,
                    **({} if request.chapter is None else {"chapter": request.chapter}),
                    head=ArtifactHead(
                        artifactId=head.id,
                        version=head.version,
                        humanStatus=head.humanStatus,
                    ),
                )
            ],
        )
        self._failures.pop(work_id, None)
        return self.get_state(work_id)

    def chapter_workflow(self, work: WorkDetail, chapter: int) -> dict[str, Any] | None:
        summary = next(
            (
                item
                for item in chapter_summaries(work, self.repeat_chapters)
                if item.chapter == chapter
            ),
            None,
        )
        if summary is None:
            return None
        state = (
            "awaiting-beat-review"
            if summary.beatStatus == "pending"
            else "awaiting-prose-review"
            if summary.proseStatus == "pending"
            else "prose-approved"
            if summary.proseStatus == "approved"
            else "beat-approved"
            if summary.beatStatus == "approved"
            else "ready-to-generate"
        )
        return {
            "workflowState": state,
            "nextStepId": None,
            "allowedActions": summary.allowedActions,
        }

    async def approve_beat(
        self, work_id: str, request: BeatApproveRequest, scope: CommandScope
    ) -> tuple[Artifact, BeatExecutionObservation]:
        async def run(execution: BeatExecution) -> Artifact:
            _, baseline, preconditions = prepare_beat_review(
                self.store,
                work_id,
                request.chapter,
                request.expectedArtifactId,
                request.expectedHeadVersion,
            )
            execution.stage = "input"
            content = assign_beat_ids(request.content, baseline.content)
            execution.stage = "commit"
            return self.store.finalize_artifact(
                work_id,
                "beat",
                chapter=request.chapter,
                expected_artifact_id=baseline.id,
                expected_head_version=baseline.version,
                content=content,
                preconditions=preconditions,
            )

        artifact, command = await observe_beat(
            work_id,
            "approve-beat",
            BeatHead(
                artifactId=request.expectedArtifactId,
                version=request.expectedHeadVersion,
            ),
            run,
            buffer=self.telemetry,
            scope=scope,
            chapter=request.chapter,
        )
        self._failures.pop(work_id, None)
        return artifact, command

    async def regenerate_beat(
        self, work_id: str, request: BeatRegenerateRequest, scope: CommandScope
    ) -> dict[str, Any]:
        if request.regeneration is not None:
            return await self._regenerate_chapter_beat(work_id, request, scope)
        with self._generation_lock(work_id):
            comparison = None

            async def run(execution: BeatExecution) -> Artifact:
                nonlocal comparison
                work, baseline, preconditions = prepare_beat_review(
                    self.store,
                    work_id,
                    request.chapter,
                    request.expectedArtifactId,
                    request.expectedHeadVersion,
                )
                workflow = self.chapter_workflow(work, request.chapter)
                if workflow is None or workflow["workflowState"] != "awaiting-beat-review":
                    raise KnownError("beat-gate-not-ready", "beat gate not ready")
                entry = next(
                    item
                    for item in self.definition_for(request.chapter)
                    if item.outputKind == "beat" and item.chapter == request.chapter
                )
                execution.stage = "input"
                assert_beat_ids(request.content, baseline.content)
                regeneration = BeatRegeneration(
                    content=request.content,
                    instructions=request.instructions,
                )
                artifact = await self._execute_entry(
                    work_id,
                    entry,
                    self._operation_configs(work_id),
                    baseline=baseline,
                    beat_regeneration=regeneration,
                    additional_preconditions=preconditions,
                    execution=execution,
                )
                comparison = {"original": baseline, "candidate": artifact}
                return artifact

            artifact, command = await observe_beat(
                work_id,
                "regenerate-beat",
                BeatHead(
                    artifactId=request.expectedArtifactId,
                    version=request.expectedHeadVersion,
                ),
                run,
                buffer=self.telemetry,
                scope=scope,
                chapter=request.chapter,
                regeneration=request.regeneration,
            )
            return {
                "artifact": artifact,
                "command": command,
                "comparison": comparison,
            }

    def select_beat_variant(
        self, work_id: str, request: BeatVariantSelectionRequest
    ) -> dict[str, Any]:
        with self._generation_lock(work_id):
            work = self.store.get_work(work_id)
            if work is None:
                raise KnownError("work-not-found", "work not found")
            state = self.get_state(work_id)
            if (
                state.stage != "awaiting-approval"
                or state.pendingGate is None
                or state.pendingGate.kind != "beat"
                or state.pendingGate.chapter != request.chapter
            ):
                raise KnownError("beat-gate-not-ready", "beat gate not ready")
            current = next(
                (
                    item
                    for item in work.artifacts
                    if item.kind == "beat" and item.chapter == request.chapter
                ),
                None,
            )
            if (
                current is None
                or current.id != request.expectedArtifactId
                or current.version != request.expectedHeadVersion
            ):
                raise KnownError("version-conflict", "beat head changed")
            if current.humanStatus != "pending":
                raise KnownError("artifact-already-approved", "beat already approved")
            original = self.store.get_artifact_version(
                work_id,
                "beat",
                request.chapter,
                request.originalArtifactId,
                request.originalVersion,
            )
            if (
                original is None
                or original.chapter != request.chapter
                or original.content.model_dump() != request.originalContent.model_dump()
            ):
                raise KnownError(
                    "version-conflict", "original beat version is not the requested history"
                )
            if (
                original.version != current.version - 1
                or original.id == current.id
                or original.humanStatus != "pending"
            ):
                raise KnownError(
                    "version-conflict", "original beat must be the pending immediate predecessor"
                )
            comparison = {"original": original, "candidate": current}
            selection = {
                "operation": "select-beat-variant",
                "workId": work_id,
                "chapter": request.chapter,
                "expectedHead": {
                    "artifactId": current.id,
                    "version": current.version,
                },
                "originalHead": {
                    "artifactId": original.id,
                    "version": original.version,
                },
                "choice": request.choice,
            }
            if request.choice == "new":
                return {
                    "artifact": current,
                    "comparison": comparison,
                    "choice": "new",
                    "selection": {
                        **selection,
                        "writeOutcome": "not-committed",
                        "resultHead": {
                            "artifactId": current.id,
                            "version": current.version,
                            "humanStatus": current.humanStatus,
                        },
                    },
                }
            artifact = self.store.append_artifact(
                work_id,
                "beat",
                original.content,
                chapter=request.chapter,
                inputs=original.inputs,
                preconditions=[
                    ArtifactPrecondition(
                        kind="beat",
                        chapter=request.chapter,
                        head=ArtifactHead(
                            artifactId=current.id,
                            version=current.version,
                            humanStatus="pending",
                        ),
                    )
                ],
            )
            return {
                "artifact": artifact,
                "comparison": comparison,
                "choice": "original",
                "selection": {
                    **selection,
                    "writeOutcome": "committed",
                    "resultHead": {
                        "artifactId": artifact.id,
                        "version": artifact.version,
                        "humanStatus": artifact.humanStatus,
                    },
                },
            }

    async def approve_prose(
        self, work_id: str, request: ProseApproveRequest, scope: CommandScope
    ) -> tuple[Artifact, ProseExecutionObservation]:
        async def run(execution: ProseExecution) -> Artifact:
            _, baseline, preconditions = prepare_prose_review(
                self.store,
                work_id,
                request.chapter,
                request.expectedArtifactId,
                request.expectedHeadVersion,
            )
            execution.stage = "input"
            execution.stage = "commit"
            return self.store.finalize_artifact(
                work_id,
                "prose",
                chapter=request.chapter,
                expected_artifact_id=baseline.id,
                expected_head_version=baseline.version,
                content=request.content,
                preconditions=preconditions,
            )

        artifact, command = await observe_prose(
            work_id,
            "approve-prose",
            ProseHead(
                artifactId=request.expectedArtifactId,
                version=request.expectedHeadVersion,
            ),
            run,
            buffer=self.telemetry,
            scope=scope,
            chapter=request.chapter,
        )
        self._failures.pop(work_id, None)
        return artifact, command

    async def save_prose(
        self, work_id: str, request: ProseSaveRequest, scope: CommandScope
    ) -> tuple[Artifact, ProseExecutionObservation]:
        async def run(execution: ProseExecution) -> Artifact:
            _, baseline, preconditions = prepare_prose_review(
                self.store,
                work_id,
                request.chapter,
                request.expectedArtifactId,
                request.expectedHeadVersion,
                request.expectedHumanStatus,
            )
            execution.stage = "input"
            execution.stage = "commit"
            return self.store.save_artifact(
                work_id,
                "prose",
                chapter=request.chapter,
                expected_artifact_id=baseline.id,
                expected_head_version=baseline.version,
                expected_human_status=request.expectedHumanStatus,
                content=request.content,
                preconditions=preconditions,
            )

        artifact, command = await observe_prose(
            work_id,
            "save-prose",
            ProseHead(
                artifactId=request.expectedArtifactId,
                version=request.expectedHeadVersion,
                humanStatus=request.expectedHumanStatus,
            ),
            run,
            buffer=self.telemetry,
            scope=scope,
            chapter=request.chapter,
        )
        self._failures.pop(work_id, None)
        return artifact, command

    async def regenerate_prose(
        self, work_id: str, request: ProseRegenerateRequest, scope: CommandScope
    ) -> tuple[Artifact, ProseExecutionObservation]:
        if request.regeneration is not None:
            return await self._regenerate_chapter_prose(work_id, request, scope)
        with self._generation_lock(work_id):

            async def run(execution: ProseExecution) -> Artifact:
                work, baseline, preconditions = prepare_prose_review(
                    self.store,
                    work_id,
                    request.chapter,
                    request.expectedArtifactId,
                    request.expectedHeadVersion,
                )
                workflow = self.chapter_workflow(work, request.chapter)
                if workflow is None or workflow["workflowState"] != "awaiting-prose-review":
                    raise KnownError("prose-gate-not-ready", "prose gate not ready")
                entry = next(
                    item
                    for item in self.definition_for(request.chapter)
                    if item.outputKind == "prose" and item.chapter == request.chapter
                )
                execution.stage = "input"
                regeneration = ProseRegeneration(
                    content=request.content,
                    instructions=request.instructions,
                )
                return await self._execute_entry(
                    work_id,
                    entry,
                    self._operation_configs(work_id),
                    baseline=baseline,
                    prose_regeneration=regeneration,
                    additional_preconditions=preconditions,
                    execution=execution,
                )

            return await observe_prose(
                work_id,
                "regenerate-prose",
                ProseHead(
                    artifactId=request.expectedArtifactId,
                    version=request.expectedHeadVersion,
                ),
                run,
                buffer=self.telemetry,
                scope=scope,
                chapter=request.chapter,
                regeneration=request.regeneration,
            )

    async def _regenerate_chapter_beat(
        self, work_id: str, request: BeatRegenerateRequest, scope: CommandScope
    ) -> dict[str, Any]:
        with self._generation_lock(work_id):
            comparison = None

            async def run(execution: BeatExecution) -> Artifact:
                nonlocal comparison
                work = self.store.get_work(work_id)
                if work is None:
                    raise KnownError("work-not-found", "work not found")
                binding = request.regeneration
                assert binding is not None
                beat = next(
                    (
                        item
                        for item in work.artifacts
                        if item.kind == "beat" and item.chapter == request.chapter
                    ),
                    None,
                )
                prose = next(
                    (
                        item
                        for item in work.artifacts
                        if item.kind == "prose" and item.chapter == request.chapter
                    ),
                    None,
                )
                if (
                    beat is None
                    or prose is None
                    or beat.id != binding.expectedBeat.artifactId
                    or beat.version != binding.expectedBeat.version
                    or prose.id != binding.expectedProse.artifactId
                    or prose.version != binding.expectedProse.version
                    or request.expectedArtifactId != binding.expectedBeat.artifactId
                    or request.expectedHeadVersion != binding.expectedBeat.version
                ):
                    raise KnownError("version-conflict", "chapter regeneration head changed")
                if beat.humanStatus != "approved" or prose.humanStatus != "approved":
                    raise KnownError(
                        "beat-gate-not-ready",
                        "chapter regeneration requires approved beat and prose",
                    )
                entry = next(
                    item
                    for item in self.definition_for(request.chapter)
                    if item.outputKind == "beat" and item.chapter == request.chapter
                )
                execution.stage = "input"
                assert_beat_ids(request.content, beat.content)
                artifact = await self._execute_entry(
                    work_id,
                    entry,
                    self._operation_configs(work_id),
                    baseline=beat,
                    beat_regeneration=BeatRegeneration(
                        content=request.content,
                        instructions=request.instructions,
                    ),
                    additional_preconditions=[
                        ArtifactPrecondition(
                            kind="prose",
                            chapter=request.chapter,
                            head=ArtifactHead(
                                artifactId=prose.id,
                                version=prose.version,
                                humanStatus="approved",
                            ),
                        )
                    ],
                    execution=execution,
                )
                comparison = {"original": beat, "candidate": artifact}
                return artifact

            artifact, command = await observe_beat(
                work_id,
                "regenerate-beat",
                BeatHead(
                    artifactId=request.expectedArtifactId,
                    version=request.expectedHeadVersion,
                ),
                run,
                buffer=self.telemetry,
                scope=scope,
                chapter=request.chapter,
                regeneration=request.regeneration,
            )
            return {"artifact": artifact, "command": command, "comparison": comparison}

    async def _regenerate_chapter_prose(
        self, work_id: str, request: ProseRegenerateRequest, scope: CommandScope
    ) -> tuple[Artifact, ProseExecutionObservation]:
        with self._generation_lock(work_id):

            async def run(execution: ProseExecution) -> Artifact:
                work = self.store.get_work(work_id)
                if work is None:
                    raise KnownError("work-not-found", "work not found")
                binding = request.regeneration
                assert binding is not None
                beat = next(
                    (
                        item
                        for item in work.artifacts
                        if item.kind == "beat" and item.chapter == request.chapter
                    ),
                    None,
                )
                prose = next(
                    (
                        item
                        for item in work.artifacts
                        if item.kind == "prose" and item.chapter == request.chapter
                    ),
                    None,
                )
                if (
                    beat is None
                    or prose is None
                    or beat.id != binding.expectedBeat.artifactId
                    or beat.version != binding.expectedBeat.version
                    or prose.id != binding.expectedProse.artifactId
                    or prose.version != binding.expectedProse.version
                    or request.expectedArtifactId != binding.expectedProse.artifactId
                    or request.expectedHeadVersion != binding.expectedProse.version
                ):
                    raise KnownError("version-conflict", "chapter regeneration head changed")
                if beat.humanStatus != "approved" or prose.humanStatus != "approved":
                    raise KnownError(
                        "prose-gate-not-ready",
                        "chapter regeneration requires an approved beat and prose",
                    )
                previous_beat_input = next(
                    (
                        ref
                        for ref in prose.inputs or []
                        if ref.kind == "beat" and ref.chapter == request.chapter
                    ),
                    None,
                )
                if previous_beat_input is None or (
                    previous_beat_input.artifactId == beat.id
                    and previous_beat_input.version == beat.version
                ):
                    raise KnownError(
                        "prose-gate-not-ready",
                        "chapter beat has not been replanned or its source is unavailable",
                    )
                entry = next(
                    item
                    for item in self.definition_for(request.chapter)
                    if item.outputKind == "prose" and item.chapter == request.chapter
                )
                execution.stage = "input"
                return await self._execute_entry(
                    work_id,
                    entry,
                    self._operation_configs(work_id),
                    baseline=prose,
                    prose_regeneration=ProseRegeneration(
                        content=request.content,
                        instructions=request.instructions,
                    ),
                    additional_preconditions=[
                        ArtifactPrecondition(
                            kind="beat",
                            chapter=request.chapter,
                            head=ArtifactHead(
                                artifactId=beat.id,
                                version=beat.version,
                                humanStatus="approved",
                            ),
                        ),
                        ArtifactPrecondition(
                            kind="prose",
                            chapter=request.chapter,
                            head=ArtifactHead(
                                artifactId=prose.id,
                                version=prose.version,
                                humanStatus="approved",
                            ),
                        ),
                    ],
                    execution=execution,
                )

            return await observe_prose(
                work_id,
                "regenerate-prose",
                ProseHead(
                    artifactId=request.expectedArtifactId,
                    version=request.expectedHeadVersion,
                ),
                run,
                buffer=self.telemetry,
                scope=scope,
                chapter=request.chapter,
                regeneration=request.regeneration,
            )

    async def start_chapter(
        self,
        work_id: str,
        request: StartChapterRequest,
        *,
        scope: CommandScope | None = None,
        request_id: str | None = None,
        telemetry_cursor: int | None = None,
    ) -> dict[str, Any]:
        request = StartChapterRequest.model_validate(request)
        scope = scope or CommandScope.create(
            self.runtime, cursor=telemetry_cursor, request_id=request_id
        )
        with self._generation_lock(work_id):
            work = self.store.get_work(work_id)
            if work is None:
                raise KnownError("work-not-found", "work not found")
            state = self.get_state(work_id)
            if any(
                artifact.kind == "beat" and artifact.chapter == request.chapter
                for artifact in work.artifacts
            ):
                return {
                    "kind": "complete" if state.stage == "complete" else "awaiting-approval",
                    "state": state,
                }
            if request.chapter != current_chapter_of(work) + 1 or state.stage != "complete":
                raise KnownError(
                    "chapter-not-ready", "finish the current chapter before starting the next"
                )
            previous_beat = next(
                (
                    item
                    for item in work.artifacts
                    if item.kind == "beat" and item.chapter == request.chapter - 1
                ),
                None,
            )
            previous_prose = next(
                (
                    item
                    for item in work.artifacts
                    if item.kind == "prose" and item.chapter == request.chapter - 1
                ),
                None,
            )
            if (
                previous_beat is None
                or previous_beat.humanStatus != "approved"
                or previous_prose is None
                or previous_prose.humanStatus != "approved"
            ):
                raise KnownError("chapter-not-ready", "previous chapter must be approved")
            if not any(
                ref.kind == "beat"
                and ref.chapter == request.chapter - 1
                and ref.artifactId == previous_beat.id
                and ref.version == previous_beat.version
                for ref in previous_prose.inputs or []
            ):
                raise KnownError(
                    "chapter-not-ready",
                    "previous chapter prose must consume the current approved beat",
                )
            if (
                previous_prose.id != request.expectedPreviousProseId
                or previous_prose.version != request.expectedPreviousProseVersion
            ):
                raise KnownError("version-conflict", "previous chapter has changed")
            entry = next(
                item for item in self.definition_for(request.chapter) if item.outputKind == "beat"
            )
            try:
                _, command = await observe_beat(
                    work_id,
                    "generate-beat",
                    None,
                    lambda execution: self._execute_entry(
                        work_id,
                        entry,
                        self._operation_configs(work_id),
                        request_id=scope.request_id,
                        execution=execution,
                    ),
                    buffer=self.telemetry,
                    scope=scope,
                    chapter=request.chapter,
                )
            except Exception as error:
                cause = error.cause if isinstance(error, BeatCommandError) else error
                known = cause if isinstance(cause, KnownError) else None
                code = (
                    beat_failure_code(cause, error.command.failureStage or "response")
                    if isinstance(error, BeatCommandError)
                    else known.code
                    if known
                    else "llm-unavailable"
                )
                retryable = code == "upstream-changed" or (known.retryable if known else True)
                self._failures[work_id] = {
                    "stepId": "beat",
                    "code": code,
                    "retryable": retryable,
                }
                return {
                    "kind": "failed",
                    "stepId": "beat",
                    "code": code,
                    "retryable": retryable,
                    **(
                        {"attemptId": known.attemptId}
                        if known is not None and known.attemptId is not None
                        else {}
                    ),
                    "state": self.get_state(work_id),
                    **(
                        {"beatCommand": error.command}
                        if isinstance(error, BeatCommandError)
                        else {}
                    ),
                }
            self._failures.pop(work_id, None)
            return {
                "kind": "advanced",
                "stepId": "beat",
                "state": self.get_state(work_id),
                "beatCommand": command,
            }
