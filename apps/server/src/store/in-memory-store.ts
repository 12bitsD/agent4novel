import {
  emptyAgentConfig,
  artifactSchema,
  workSchema,
  workDetailSchema,
  workCreateRequestSchema,
  workListResponseSchema,
} from "@agent4novel/contracts";
import { randomUUID } from "node:crypto";
import type {
  Artifact,
  ArtifactKind,
  HumanStatus,
  JsonValue,
  Work,
  WorkDetail,
  WorkSummary,
  WorkCreateRequest,
} from "@agent4novel/contracts";
import { KnownError } from "../errors.js";
import {
  actOnExtension,
  proposeExtension,
  extensionReceipt,
  extensionResource,
  isValidApprovedExtensionCandidate,
} from "../setting-extension.js";
import {
  settingExtensionProposalRecordSchema,
  type SettingExtensionProposalRecord,
  type SettingExtensionProposeRequest,
  type SettingExtensionActionRequest,
  type SettingExtensionReceipt,
  type SettingExtensionResource,
} from "@agent4novel/contracts";
import type {
  AppendOptions,
  ArtifactPrecondition,
  FinalizeArtifactInput,
  SaveArtifactInput,
  WorkStore,
} from "./work-store.js";

import { StoreContractError, validateStoreValue } from "./validation.js";
import {
  assertBucketAddress,
  assertDirectStatusAllowed,
} from "./invariants.js";

type Bucket = { kind: ArtifactKind; chapter?: number; versions: Artifact[] };

export class InMemoryStore implements WorkStore {
  private extensionProposals = new Map<
    string,
    SettingExtensionProposalRecord
  >();
  private works = new Map<string, Work>();
  private buckets = new Map<string, Bucket[]>();
  private nextId(prefix: string): string {
    // randomUUID：生成随机 ID。
    return `${prefix}-${randomUUID()}`;
  }

  private findBucket(
    workId: string,
    kind: ArtifactKind,
    chapter?: number,
  ): Bucket | undefined {
    // find：查找元素。
    // get：读取值。
    return this.buckets
      .get(workId)
      ?.find((b) => b.kind === kind && b.chapter === chapter);
  }

  private assertPreconditions(
    workId: string,
    kind: ArtifactKind,
    chapter: number | undefined,
    preconditions: readonly ArtifactPrecondition[] = [],
  ): void {
    for (const condition of preconditions) {
      // assertBucketAddress：校验当前条件。
      assertBucketAddress(condition.kind, condition.chapter);
      // findBucket：读取当前数据。
      const bucket = this.findBucket(workId, condition.kind, condition.chapter);
      // at：处理当前步骤。
      const head = bucket?.versions.at(-1);
      const matches =
        condition.head === null
          ? bucket === undefined
          : head?.id === condition.head.artifactId &&
            head.version === condition.head.version &&
            head.humanStatus === condition.head.humanStatus;
      if (!matches) {
        const isTarget =
          condition.kind === kind && condition.chapter === chapter;
        throw new KnownError(
          isTarget ? "version-conflict" : "upstream-changed",
          `artifact precondition changed: ${workId}/${condition.kind}`,
        );
      }
    }
  }

  createWork(input: WorkCreateRequest): Work {
    // validateStoreValue：校验当前条件。
    const parsed = validateStoreValue(workCreateRequestSchema, input, "input");
    // trim：处理当前步骤。
    const title = parsed.title?.trim() || undefined;
    // nextId：处理当前步骤。
    // slice：截取片段。
    // structuredClone：深拷贝数据。
    // toISOString：转换当前数据。
    const work: Work = {
      id: this.nextId("work"),
      title: title ?? parsed.seed.slice(0, 20),
      seed: parsed.seed,
      config: structuredClone(emptyAgentConfig),
      createdAt: new Date().toISOString(),
    };
    // validateStoreValue：校验当前条件。
    const snapshot = validateStoreValue(workSchema, work, "input");
    // set：写入值。
    this.works.set(work.id, work);
    // set：写入值。
    this.buckets.set(work.id, []);
    return snapshot;
  }

  listWorks(): WorkSummary[] {
    // validateStoreValue：校验当前条件。
    // map：转换数组元素。
    // keys：读取对象键。
    return validateStoreValue(
      workListResponseSchema,
      [...this.works.keys()].map((id) => {
        // getWork：读取当前数据。
        const w = this.getWork(id)!;
        // get：读取值。
        const buckets = this.buckets.get(w.id) ?? [];
        // filter：筛选元素。
        // at：处理当前步骤。
        const chapterCount = buckets.filter(
          (b) =>
            b.kind === "prose" && b.versions.at(-1)?.humanStatus === "approved",
        ).length;
        // slice：截取片段。
        return {
          id: w.id,
          title: w.title,
          seedPreview: w.seed.length > 40 ? `${w.seed.slice(0, 40)}…` : w.seed,
          chapterCount,
        };
      }),
      "stored",
    );
  }

  getWork(id: string): WorkDetail | undefined {
    // get：读取值。
    const work = this.works.get(id);
    if (!work) {
      return undefined;
    }
    // filter：筛选元素。
    // map：转换数组元素。
    // get：读取值。
    const artifacts = (this.buckets.get(id) ?? [])
      .map((b) => b.versions[b.versions.length - 1])
      .filter((a): a is Artifact => a !== undefined);
    // validateStoreValue：校验当前条件。
    return validateStoreValue(
      workDetailSchema,
      { ...work, artifacts },
      "stored",
    );
  }

  // bits:allow(BCS004): WorkStore 接口要求按位置传出版本坐标
  getArtifactVersion(
    workId: string,
    kind: ArtifactKind,
    chapter: number | undefined,
    artifactId: string,
    version: number,
  ): Artifact | undefined {
    // find：查找元素。
    // findBucket：读取当前数据。
    const artifact = this.findBucket(workId, kind, chapter)?.versions.find(
      (candidate) =>
        candidate.id === artifactId && candidate.version === version,
    );
    // validateStoreValue：校验当前条件。
    return artifact === undefined
      ? undefined
      : validateStoreValue(artifactSchema, artifact, "stored");
  }

  appendArtifact(
    workId: string,
    kind: ArtifactKind,
    content: JsonValue,
    opts?: AppendOptions,
  ): Artifact {
    // has：检查存在性。
    if (!this.works.has(workId)) {
      throw new KnownError("work-not-found", `work not found: ${workId}`);
    }
    // structuredClone：深拷贝数据。
    const options = structuredClone(opts);
    const chapter = options?.chapter;
    // assertBucketAddress：校验当前条件。
    assertBucketAddress(kind, chapter);
    if (options?.humanStatus === "approved") {
      // assertDirectStatusAllowed：校验当前条件。
      assertDirectStatusAllowed(kind);
    }
    // structuredClone：深拷贝数据。
    const storedContent = structuredClone(content);
    // assertPreconditions：校验当前条件。
    this.assertPreconditions(workId, kind, chapter, options?.preconditions);
    // findBucket：读取当前数据。
    const bucket = this.findBucket(workId, kind, chapter);
    // nextId：处理当前步骤。
    // toISOString：转换当前数据。
    const artifact: Artifact = {
      id: this.nextId("artifact"),
      workId,
      kind,
      chapter,
      version: (bucket?.versions.length ?? 0) + 1,
      content: storedContent,
      humanStatus: options?.humanStatus ?? "pending",
      createdAt: new Date().toISOString(),
      ...(options?.inputs ? { inputs: options.inputs } : {}),
    };
    // validateStoreValue：校验当前条件。
    const snapshot = validateStoreValue(artifactSchema, artifact, "input");
    const candidate: Bucket = {
      kind,
      chapter,
      versions: [...(bucket?.versions ?? []), artifact],
    };
    // get：读取值。
    const previous = this.buckets.get(workId)!;
    // map：转换数组元素。
    const next = bucket
      ? previous.map((entry) => (entry === bucket ? candidate : entry))
      : [...previous, candidate];
    // set：写入值。
    this.buckets.set(workId, next);
    return snapshot;
  }

  finalizeArtifact(input: FinalizeArtifactInput): Artifact {
    // structuredClone：深拷贝数据。
    const request = structuredClone(input);
    const { workId, kind, chapter } = request;
    // has：检查存在性。
    if (!this.works.has(workId)) {
      throw new KnownError("work-not-found", `work not found: ${workId}`);
    }
    // assertBucketAddress：校验当前条件。
    assertBucketAddress(kind, chapter);
    // findBucket：读取当前数据。
    const bucket = this.findBucket(workId, kind, chapter);
    // at：处理当前步骤。
    const head = bucket?.versions.at(-1);
    if (
      !bucket ||
      !head ||
      head.id !== request.expectedArtifactId ||
      head.version !== request.expectedHeadVersion
    ) {
      throw new KnownError(
        "version-conflict",
        `artifact head changed: ${workId}/${kind}`,
      );
    }
    if (head.humanStatus === "approved") {
      throw new KnownError(
        "artifact-already-approved",
        `artifact already approved: ${workId}/${kind}`,
      );
    }
    // assertPreconditions：校验当前条件。
    this.assertPreconditions(workId, kind, chapter, request.preconditions);
    const artifact: Artifact = {
      ...head,
      content: request.content,
      humanStatus: "approved",
    };
    // validateStoreValue：校验当前条件。
    const snapshot = validateStoreValue(artifactSchema, artifact, "input");
    // slice：截取片段。
    const candidate: Bucket = {
      ...bucket,
      versions: [...bucket.versions.slice(0, -1), artifact],
    };
    // map：转换数组元素。
    // get：读取值。
    const next = this.buckets
      .get(workId)!
      .map((entry) => (entry === bucket ? candidate : entry));
    // set：写入值。
    this.buckets.set(workId, next);
    return snapshot;
  }

  saveArtifact(input: SaveArtifactInput): Artifact {
    // structuredClone：深拷贝数据。
    const request = structuredClone(input);
    const { workId, kind, chapter } = request;
    // has：检查存在性。
    if (!this.works.has(workId)) {
      throw new KnownError("work-not-found", `work not found: ${workId}`);
    }
    // assertBucketAddress：校验当前条件。
    assertBucketAddress(kind, chapter);
    // findBucket：读取当前数据。
    const bucket = this.findBucket(workId, kind, chapter);
    // at：处理当前步骤。
    const head = bucket?.versions.at(-1);
    if (
      !bucket ||
      !head ||
      head.id !== request.expectedArtifactId ||
      head.version !== request.expectedHeadVersion ||
      head.humanStatus !== request.expectedHumanStatus
    ) {
      throw new KnownError(
        "version-conflict",
        `artifact head changed: ${workId}/${kind}`,
      );
    }
    // assertPreconditions：校验当前条件。
    this.assertPreconditions(workId, kind, chapter, request.preconditions);
    // nextId：处理当前步骤。
    // toISOString：转换当前数据。
    const artifact: Artifact = {
      ...head,
      id: this.nextId("artifact"),
      version: head.version + 1,
      content: request.content,
      createdAt: new Date().toISOString(),
    };
    // validateStoreValue：校验当前条件。
    const snapshot = validateStoreValue(artifactSchema, artifact, "input");
    const candidate: Bucket = {
      ...bucket,
      versions: [...bucket.versions, artifact],
    };
    // set：写入值。
    // map：转换数组元素。
    // get：读取值。
    this.buckets.set(
      workId,
      this.buckets
        .get(workId)!
        .map((entry) => (entry === bucket ? candidate : entry)),
    );
    return snapshot;
  }

  private extensionKey(workId: string, requestId: string): string {
    // stringify：序列化数据。
    return JSON.stringify([workId, requestId]);
  }

  private extensionRecord(
    workId: string,
    requestId: string,
  ): SettingExtensionProposalRecord | undefined {
    // get：读取值。
    // extensionKey：处理当前步骤。
    const record = this.extensionProposals.get(
      this.extensionKey(workId, requestId),
    );
    // validateStoreValue：校验当前条件。
    return record === undefined
      ? undefined
      : validateStoreValue(
          settingExtensionProposalRecordSchema,
          record,
          "stored",
        );
  }

  private validateExtensionCandidate(
    record: SettingExtensionProposalRecord | undefined,
  ): void {
    if (!record || record.status !== "approved") {
      return;
    }
    // getArtifactVersion：读取当前数据。
    const candidate =
      record.candidate === null
        ? undefined
        : this.getArtifactVersion(
            record.workId,
            "setting",
            undefined,
            record.candidate.artifactId,
            record.candidate.version,
          );
    // getArtifactVersion：读取当前数据。
    const base = this.getArtifactVersion(
      record.workId,
      "setting",
      undefined,
      record.expectedBase.artifactId,
      record.expectedBase.version,
    );
    // isValidApprovedExtensionCandidate：校验当前条件。
    if (!isValidApprovedExtensionCandidate(record, candidate, base)) {
      throw new StoreContractError("invalid-stored-data");
    }
  }

  private requireExtensionWork(workId: string): WorkDetail {
    // getWork：读取当前数据。
    const work = this.getWork(workId);
    if (!work) {
      throw new KnownError("work-not-found", "work not found");
    }
    return work;
  }

  proposeSettingExtension(
    workId: string,
    request: SettingExtensionProposeRequest,
  ): SettingExtensionReceipt {
    // requireExtensionWork：校验当前条件。
    const work = this.requireExtensionWork(workId);
    // extensionKey：处理当前步骤。
    const key = this.extensionKey(workId, request.requestId);
    // extensionRecord：处理当前步骤。
    const prior = this.extensionRecord(workId, request.requestId);
    // proposeExtension：处理当前步骤。
    const record = proposeExtension(work, request, prior);
    if (record !== prior) {
      // set：写入值。
      // structuredClone：深拷贝数据。
      this.extensionProposals.set(key, structuredClone(record));
    } else {
      // validateExtensionCandidate：校验当前条件。
      this.validateExtensionCandidate(prior);
    }
    // extensionReceipt：处理当前步骤。
    return extensionReceipt(record, "propose");
  }

  private actSettingExtension(
    workId: string,
    request: SettingExtensionActionRequest,
    operation: "approve" | "cancel",
  ): SettingExtensionReceipt {
    // requireExtensionWork：校验当前条件。
    const work = this.requireExtensionWork(workId);
    // extensionKey：处理当前步骤。
    const key = this.extensionKey(workId, request.requestId);
    // extensionRecord：处理当前步骤。
    const prior = this.extensionRecord(workId, request.requestId);
    // actOnExtension：处理当前步骤。
    const plan = actOnExtension(work, request, prior, operation);
    if (plan.replay) {
      if (operation === "approve") {
        // validateExtensionCandidate：校验当前条件。
        this.validateExtensionCandidate(prior);
      }
      // extensionReceipt：处理当前步骤。
      return extensionReceipt(plan.record, operation);
    }
    // Prepare both replacement values before the commit. This synchronous
    // section
    // has no callback/yield where another in-memory writer could interleave.
    if (plan.artifact) {
      // findBucket：读取当前数据。
      const bucket = this.findBucket(workId, "setting")!;
      // structuredClone：深拷贝数据。
      const candidate: Bucket = {
        ...bucket,
        versions: [...bucket.versions, structuredClone(plan.artifact)],
      };
      // map：转换数组元素。
      // get：读取值。
      const next = this.buckets
        .get(workId)!
        .map((entry) => (entry === bucket ? candidate : entry));
      // structuredClone：深拷贝数据。
      const storedRecord = structuredClone(plan.record);
      // set：写入值。
      this.buckets.set(workId, next);
      // set：写入值。
      this.extensionProposals.set(key, storedRecord);
    } else {
      // set：写入值。
      // structuredClone：深拷贝数据。
      this.extensionProposals.set(key, structuredClone(plan.record));
    }
    // extensionReceipt：处理当前步骤。
    return extensionReceipt(plan.record, operation);
  }

  approveSettingExtension(
    workId: string,
    request: SettingExtensionActionRequest,
  ): SettingExtensionReceipt {
    // actSettingExtension：处理当前步骤。
    return this.actSettingExtension(workId, request, "approve");
  }

  cancelSettingExtension(
    workId: string,
    request: SettingExtensionActionRequest,
  ): SettingExtensionReceipt {
    // actSettingExtension：处理当前步骤。
    return this.actSettingExtension(workId, request, "cancel");
  }

  getSettingExtension(
    workId: string,
    requestId: string,
  ): SettingExtensionResource {
    // requireExtensionWork：校验当前条件。
    const work = this.requireExtensionWork(workId);
    // extensionRecord：处理当前步骤。
    const record = this.extensionRecord(workId, requestId);
    // validateExtensionCandidate：校验当前条件。
    this.validateExtensionCandidate(record);
    // extensionResource：处理当前步骤。
    return extensionResource(work, requestId, record);
  }

  setStatus(
    workId: string,
    kind: ArtifactKind,
    status: HumanStatus,
    opts?: {
      chapter?: number;
      preconditions?: readonly ArtifactPrecondition[];
    },
  ): void {
    // assertDirectStatusAllowed：校验当前条件。
    assertDirectStatusAllowed(kind);
    // assertBucketAddress：校验当前条件。
    assertBucketAddress(kind, opts?.chapter);
    // assertPreconditions：校验当前条件。
    this.assertPreconditions(workId, kind, opts?.chapter, opts?.preconditions);
    // findBucket：读取当前数据。
    const bucket = this.findBucket(workId, kind, opts?.chapter);
    if (!bucket || bucket.versions.length === 0) {
      throw new KnownError(
        "artifact-not-found",
        `artifact not found: ${workId}/${kind}${opts?.chapter !== undefined ? `#${opts.chapter}` : ""}`,
      );
    }
    const index = bucket.versions.length - 1;
    // validateStoreValue：校验当前条件。
    const candidate = validateStoreValue(
      artifactSchema,
      { ...bucket.versions[index], humanStatus: status },
      "input",
    );
    bucket.versions[index] = candidate;
  }
}
