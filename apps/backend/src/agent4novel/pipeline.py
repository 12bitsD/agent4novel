from dataclasses import dataclass
from typing import Any

from .domain.diagnostics import TelemetryBuffer
from .domain.work import (
    Artifact,
    ArtifactKind,
    ChapterSummary,
    GateRef,
    PipelineState,
    WorkDetail,
    WorkflowState,
)

PER_CHAPTER_KINDS = {"beat", "prose"}


def current_chapter_of(work: WorkDetail) -> int:
    return max((artifact.chapter or 1 for artifact in work.artifacts), default=1)


def chapter_summaries(work: WorkDetail, allow_start: bool) -> list[ChapterSummary]:
    heads = {(artifact.kind, artifact.chapter): artifact for artifact in work.artifacts}
    numbers = sorted(
        {artifact.chapter for artifact in work.artifacts if artifact.chapter is not None}
    )
    current = current_chapter_of(work)
    previous_needs_review = False
    summaries = []
    for chapter in numbers:
        beat = heads.get(("beat", chapter))
        prose = heads.get(("prose", chapter))

        def stale(artifact: Artifact | None) -> bool:
            if artifact is None or artifact.inputs is None:
                return False
            for ref in artifact.inputs:
                actual = heads.get((ref.kind, ref.chapter))
                if (
                    actual is None
                    or actual.id != ref.artifactId
                    or actual.version != ref.version
                    or actual.humanStatus != "approved"
                ):
                    return True
            return False

        needs_review = previous_needs_review or stale(beat) or stale(prose)
        previous_needs_review = needs_review
        prose_beat_input = next(
            (
                ref
                for ref in (prose.inputs if prose and prose.inputs else [])
                if ref.kind == "beat" and ref.chapter == chapter
            ),
            None,
        )
        follows_beat = (
            beat is not None
            and prose_beat_input is not None
            and prose_beat_input.artifactId == beat.id
            and prose_beat_input.version == beat.version
        )
        approved_pair = (
            beat is not None
            and beat.humanStatus == "approved"
            and prose is not None
            and prose.humanStatus == "approved"
        )
        replanned = approved_pair and prose_beat_input is not None and not follows_beat
        if beat and beat.humanStatus == "pending":
            allowed_actions = ["approve", "regenerate"]
        elif prose and prose.humanStatus == "pending":
            allowed_actions = ["save-draft", "approve", "regenerate"]
        elif replanned:
            allowed_actions = ["save-draft", "regenerate-chapter-prose"]
        elif approved_pair:
            allowed_actions = ["save-draft", "regenerate-chapter"]
        elif prose and prose.humanStatus == "approved":
            allowed_actions = ["save-draft"]
        elif chapter != current:
            allowed_actions = []
        elif beat and beat.humanStatus == "approved":
            allowed_actions = ["generate"]
        else:
            allowed_actions = []
        if allow_start and chapter == current and approved_pair and follows_beat:
            allowed_actions.append("start-next-chapter")
        title = beat.content.title if beat else f"第{chapter}章"
        summaries.append(
            ChapterSummary(
                chapter=chapter,
                title=title,
                beatStatus=beat.humanStatus if beat else None,
                proseStatus=prose.humanStatus if prose else None,
                allowedActions=allowed_actions,
                needsContinuityReview=needs_review,
            )
        )
    return summaries


def workflow_of(
    state: PipelineState,
    failure: dict[str, Any] | None = None,
    completion_kind: ArtifactKind | None = "prose",
) -> tuple[WorkflowState, list[str]]:
    if state.stage == "ready":
        if failure:
            return "failed", ["generate"] if failure["retryable"] else []
        return "ready-to-generate", ["generate"]
    if state.stage == "blocked":
        return "ready-to-generate", []
    if state.stage == "complete":
        if completion_kind == "prose":
            return "prose-approved", ["save-draft"]
        if completion_kind == "beat":
            return "beat-approved", []
        if completion_kind == "setting":
            return "setting-approved", []
        return "outline-approved", []
    gate = state.pendingGate.kind if state.pendingGate else None
    actions: dict[str, tuple[WorkflowState, list[str]]] = {
        "creative": ("awaiting-selection", ["save-draft", "select", "generate"]),
        "outline": ("awaiting-outline-review", ["save-draft", "approve"]),
        "setting": ("awaiting-setting-review", ["approve"]),
        "beat": ("awaiting-beat-review", ["approve", "regenerate"]),
        "prose": ("awaiting-prose-review", ["save-draft", "approve", "regenerate"]),
    }
    if gate not in actions:
        raise ValueError(f"unknown gate kind: {gate or 'none'}")
    return actions[gate]


@dataclass(frozen=True)
class PipelineDefinitionEntry:
    stepId: str
    outputKind: ArtifactKind
    chapter: int | None = None
    consumes: tuple[ArtifactKind, ...] = ()
    gateAfter: GateRef | None = None
    gateBefore: GateRef | None = None


DEFAULT_DEFINITION = (
    PipelineDefinitionEntry(stepId="caption", outputKind="caption"),
    PipelineDefinitionEntry(
        stepId="creative",
        outputKind="creative",
        consumes=("caption",),
        gateAfter=GateRef(kind="creative"),
    ),
    PipelineDefinitionEntry(
        stepId="outline",
        outputKind="outline",
        consumes=("creative",),
        gateAfter=GateRef(kind="outline"),
    ),
    PipelineDefinitionEntry(
        stepId="setting",
        outputKind="setting",
        consumes=("caption", "creative", "outline"),
        gateAfter=GateRef(kind="setting"),
    ),
    PipelineDefinitionEntry(
        stepId="beat",
        outputKind="beat",
        chapter=1,
        consumes=("outline", "setting"),
        gateAfter=GateRef(kind="beat", chapter=1),
    ),
    PipelineDefinitionEntry(
        stepId="prose",
        outputKind="prose",
        chapter=1,
        consumes=("beat", "setting"),
        gateAfter=GateRef(kind="prose", chapter=1),
    ),
)


class Pipeline:
    def __init__(self, store: Any, repeat_chapters: bool = True) -> None:
        self.store = store
        self.repeat_chapters = repeat_chapters
        self.telemetry = TelemetryBuffer()
        self.definition = DEFAULT_DEFINITION
        self.completion_kind: ArtifactKind | None = "prose"

    def definition_for(self, chapter: int) -> tuple[PipelineDefinitionEntry, ...]:
        if not self.repeat_chapters:
            return self.definition
        return tuple(
            PipelineDefinitionEntry(
                stepId=entry.stepId,
                outputKind=entry.outputKind,
                chapter=chapter if entry.outputKind in PER_CHAPTER_KINDS else entry.chapter,
                consumes=entry.consumes,
                gateAfter=GateRef(kind=entry.gateAfter.kind, chapter=chapter)
                if entry.gateAfter and entry.gateAfter.kind in PER_CHAPTER_KINDS
                else entry.gateAfter,
                gateBefore=entry.gateBefore,
            )
            for entry in self.definition
        )

    @staticmethod
    def dependency_chapter(entry: PipelineDefinitionEntry, kind: ArtifactKind) -> int | None:
        return entry.chapter if kind in PER_CHAPTER_KINDS else None

    def get_state(self, work_id: str) -> PipelineState:
        work = self.store.get_work(work_id)
        if work is None:
            raise ValueError("work-not-found")
        latest = {(artifact.kind, artifact.chapter): artifact for artifact in work.artifacts}
        for entry in self.definition_for(current_chapter_of(work)):
            output = latest.get((entry.outputKind, entry.chapter))
            if output is None:
                if self.repeat_chapters and entry.chapter and entry.chapter > 1:
                    for kind in ("beat", "prose"):
                        previous = latest.get((kind, entry.chapter - 1))
                        if previous is None or previous.humanStatus != "approved":
                            return PipelineState(
                                workId=work_id,
                                stage="blocked",
                                nextStepId=entry.stepId,
                                pendingGate=GateRef(kind=kind, chapter=entry.chapter - 1),
                            )
                for dependency in entry.consumes:
                    chapter = self.dependency_chapter(entry, dependency)
                    upstream = latest.get((dependency, chapter))
                    if upstream is None or upstream.humanStatus != "approved":
                        return PipelineState(
                            workId=work_id,
                            stage="blocked",
                            nextStepId=entry.stepId,
                            pendingGate=GateRef(
                                kind=dependency,
                                **({} if chapter is None else {"chapter": chapter}),
                            ),
                        )
                if entry.gateBefore:
                    gate = latest.get((entry.gateBefore.kind, entry.gateBefore.chapter))
                    if gate is None or gate.humanStatus != "approved":
                        return PipelineState(
                            workId=work_id,
                            stage="blocked",
                            nextStepId=entry.stepId,
                            pendingGate=entry.gateBefore,
                        )
                return PipelineState(workId=work_id, stage="ready", nextStepId=entry.stepId)
            if output.humanStatus == "pending":
                return PipelineState(
                    workId=work_id,
                    stage="awaiting-approval",
                    nextStepId=None,
                    pendingGate=GateRef(
                        kind=output.kind,
                        **({} if output.chapter is None else {"chapter": output.chapter}),
                    ),
                )
        return PipelineState(workId=work_id, stage="complete", nextStepId=None)

    def failure_of(self, work_id: str) -> dict[str, Any] | None:
        return None
