import {
  beatContentSchema,
  type Artifact,
  type ChapterSummary,
  type WorkDetail,
  type WorkflowState,
} from "@agent4novel/contracts";

type ArtifactHeads = Map<string, Artifact>;
type ArtifactInput = NonNullable<Artifact["inputs"]>[number];
type ProseState = { artifact?: Artifact; beatInput?: ArtifactInput };
type StartAction = "start-next-chapter" | null;

export function currentChapterOf(work: WorkDetail): number {
  // reduce：汇总元素。
  // max：处理当前步骤。
  return work.artifacts.reduce(
    (max, artifact) => Math.max(max, artifact.chapter ?? 1),
    1,
  );
}

function artifactHeads(work: WorkDetail): ArtifactHeads {
  // map：转换数组元素。
  return new Map(
    work.artifacts.map((artifact) => [
      `${artifact.kind}:${artifact.chapter ?? ""}`,
      artifact,
    ]),
  );
}

function isStale(heads: ArtifactHeads, artifact?: Artifact): boolean {
  if (!artifact?.inputs) {
    return false;
  }
  // some：检查任一匹配。
  return artifact.inputs.some((ref) => {
    // get：读取值。
    const actual = heads.get(`${ref.kind}:${ref.chapter ?? ""}`);
    return (
      !actual ||
      actual.id !== ref.artifactId ||
      actual.version !== ref.version ||
      actual.humanStatus !== "approved"
    );
  });
}

function followsBeat(
  beat: Artifact | undefined,
  input: ArtifactInput | undefined,
): boolean {
  if (!beat || !input) {
    return false;
  }
  return input.artifactId === beat.id && input.version === beat.version;
}

function isReplanned(
  beat: Artifact | undefined,
  prose: ProseState,
): boolean {
  const approvedPair =
    beat?.humanStatus === "approved" &&
    prose.artifact?.humanStatus === "approved";
  // followsBeat：处理当前步骤。
  return (
    approvedPair &&
    prose.beatInput !== undefined &&
    !followsBeat(beat, prose.beatInput)
  );
}

function allowedChapterActions(
  chapter: number,
  current: number,
  beat: Artifact | undefined,
  prose: ProseState,
): string[] {
  const approvedPair =
    beat?.humanStatus === "approved" &&
    prose.artifact?.humanStatus === "approved";
  if (beat?.humanStatus === "pending") {
    return ["approve", "regenerate"];
  }
  if (prose.artifact?.humanStatus === "pending") {
    return ["save-draft", "approve", "regenerate"];
  }
  // isReplanned：校验当前条件。
  if (isReplanned(beat, prose)) {
    return ["save-draft", "regenerate-chapter-prose"];
  }
  if (approvedPair) {
    return ["save-draft", "regenerate-chapter"];
  }
  if (prose.artifact?.humanStatus === "approved") {
    return ["save-draft"];
  }
  if (chapter === current && beat?.humanStatus === "approved") {
    return ["generate"];
  }
  return [];
}

function chapterNumbers(work: WorkDetail): number[] {
  const numbers = new Set<number>();
  for (const artifact of work.artifacts) {
    if (artifact.chapter !== undefined) {
      // add：处理当前步骤。
      numbers.add(artifact.chapter);
    }
  }
  // sort：排序元素。
  return [...numbers].sort((left, right) => left - right);
}

// Continuity is a warning, not a new approval state. A saved edit keeps the
// original input references; later chapters remain intact and display drift.
export function chapterSummaries(
  work: WorkDetail,
  startAction: StartAction,
): ChapterSummary[] {
  // artifactHeads：处理当前步骤。
  const heads = artifactHeads(work);
  // currentChapterOf：读取当前数据。
  const current = currentChapterOf(work);
  let previousNeedsReview = false;
  const summaries: ChapterSummary[] = [];
  // chapterNumbers：处理当前步骤。
  for (const chapter of chapterNumbers(work)) {
    // get：读取值。
    const beat = heads.get(`beat:${chapter}`);
    // get：读取值。
    const prose = heads.get(`prose:${chapter}`);
    // isStale：校验当前条件。
    // isStale：校验当前条件。
    const needsContinuityReview: boolean =
      previousNeedsReview || isStale(heads, beat) || isStale(heads, prose);
    previousNeedsReview = needsContinuityReview;
    // find：查找元素。
    const beatInput = prose?.inputs?.find(
      (ref) => ref.kind === "beat" && ref.chapter === chapter,
    );
    // allowedChapterActions：处理当前步骤。
    const allowedActions = allowedChapterActions(chapter, current, beat, {
      artifact: prose,
      beatInput,
    });
    const approvedPair =
      beat?.humanStatus === "approved" && prose?.humanStatus === "approved";
    // followsBeat：处理当前步骤。
    if (
      startAction === "start-next-chapter" &&
      chapter === current &&
      approvedPair &&
      followsBeat(beat, beatInput)
    ) {
      // push：追加元素。
      allowedActions.push(startAction);
    }
    // push：追加元素。
    // safeParse：校验并解析输入。
    summaries.push({
      chapter,
      title:
        beatContentSchema.safeParse(beat?.content).data?.title ??
        `第${chapter}章`,
      beatStatus: beat?.humanStatus ?? null,
      proseStatus: prose?.humanStatus ?? null,
      allowedActions,
      needsContinuityReview,
    });
  }
  return summaries;
}

function workflowStateOf(summary: ChapterSummary): WorkflowState {
  if (summary.beatStatus === "pending") {
    return "awaiting-beat-review";
  }
  if (summary.proseStatus === "pending") {
    return "awaiting-prose-review";
  }
  if (summary.proseStatus === "approved") {
    return "prose-approved";
  }
  if (summary.beatStatus === "approved") {
    return "beat-approved";
  }
  return "ready-to-generate";
}

type ChapterWorkflow = {
  workflowState: WorkflowState;
  nextStepId: null;
  allowedActions: string[];
} | null;

export function chapterWorkflow(
  work: WorkDetail,
  chapter: number,
  startAction: StartAction,
): ChapterWorkflow {
  // find：查找元素。
  // chapterSummaries：处理当前步骤。
  const summary = chapterSummaries(work, startAction).find(
    (item) => item.chapter === chapter,
  );
  if (!summary) {
    return null;
  }
  // workflowStateOf：处理当前步骤。
  return {
    workflowState: workflowStateOf(summary),
    nextStepId: null,
    allowedActions: summary.allowedActions,
  };
}
