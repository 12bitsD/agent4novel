import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import {
  artifactSchema,
  emptyAgentConfig,
  workCreateRequestSchema,
  workDetailSchema,
  workListResponseSchema,
  workSchema,
  type Artifact,
  type ArtifactKind,
  type HumanStatus,
  type JsonValue,
  type Work,
  type WorkCreateRequest,
  type WorkDetail,
  type WorkSummary,
  authorConfigReceiptSchema,
  authorConfigSaveSchema,
  agentFileSchema,
  authorConfigLimits,
  type AuthorConfigReceipt,
  type AuthorConfigSave,
  type AgentFile,
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
import {
  assertBucketAddress,
  assertDirectStatusAllowed,
} from "./invariants.js";
import {
  getSqliteErrorCode,
  initializeSqliteDatabase,
  SqliteInitializationError,
  UnsupportedDatabaseError,
} from "./sqlite-schema.js";
import { StoreContractError, validateStoreValue } from "./validation.js";
import type {
  AppendOptions,
  ArtifactPrecondition,
  FinalizeArtifactInput,
  SaveArtifactInput,
  WorkStore,
} from "./work-store.js";
import type { AuthorConfigRepository } from "../config/author-config-repository.js";
import {
  badExampleRequestSchema,
  badExampleSchema,
  badExampleQuerySchema,
  badExamplePageSchema,
  badExampleLimits,
  matchesBadExample,
  type BadExample,
  type BadExampleRequest,
  type BadExampleQuery,
  type BadExamplePage,
} from "@agent4novel/contracts";
import type { BadExampleRepository } from "../bad-examples/repository.js";

type WorkRow = {
  id: string;
  title: string;
  seed: string;
  config: string;
  created_at: string;
};
type ArtifactRow = {
  id: string;
  work_id: string;
  kind: string;
  chapter: number | null;
  version: number;
  content: string;
  human_status: string;
  created_at: string;
  inputs: string | null;
};

function parseJson(value: string): unknown {
  try {
    // parse：解析输入。
    return JSON.parse(value);
  } catch {
    throw new StoreContractError("invalid-stored-data");
  }
}

function workFromRow(row: WorkRow): Work {
  // validateStoreValue：校验当前条件。
  // parseJson：解析当前输入。
  return validateStoreValue(
    workSchema,
    {
      id: row.id,
      title: row.title,
      seed: row.seed,
      config: parseJson(row.config),
      createdAt: row.created_at,
    },
    "stored",
  );
}

function artifactFromRow(row: ArtifactRow): Artifact {
  // validateStoreValue：校验当前条件。
  // parseJson：解析当前输入。
  // parseJson：解析当前输入。
  return validateStoreValue(
    artifactSchema,
    {
      id: row.id,
      workId: row.work_id,
      kind: row.kind,
      ...(row.chapter === null ? {} : { chapter: row.chapter }),
      version: row.version,
      content: parseJson(row.content),
      humanStatus: row.human_status,
      createdAt: row.created_at,
      ...(row.inputs === null ? {} : { inputs: parseJson(row.inputs) }),
    },
    "stored",
  );
}

function workSummary(work: WorkDetail): WorkSummary {
  let chapterCount = 0;
  for (const artifact of work.artifacts) {
    if (artifact.kind === "prose" && artifact.humanStatus === "approved") {
      chapterCount += 1;
    }
  }
  let seedPreview = work.seed;
  if (work.seed.length > 40) {
    // slice：截取片段。
    seedPreview = `${work.seed.slice(0, 40)}…`;
  }
  return { id: work.id, title: work.title, seedPreview, chapterCount };
}

type BadExampleRow = {
  id: string;
  work_id: string;
  chapter: number;
  record: string;
  request: string;
  cursor?: number;
};
const currentArtifactHead = `NOT EXISTS (
  SELECT 1 FROM artifacts newer
  WHERE newer.work_id = a.work_id AND newer.kind = a.kind
    AND newer.chapter IS a.chapter AND newer.version > a.version
)`;
function badExampleFromRow(row: BadExampleRow): BadExample {
  // validateStoreValue：校验当前条件。
  // parseJson：解析当前输入。
  const record = validateStoreValue(
    badExampleSchema,
    parseJson(row.record),
    "stored",
  );
  // validateStoreValue：校验当前条件。
  // parseJson：解析当前输入。
  const request = validateStoreValue(
    badExampleRequestSchema,
    parseJson(row.request),
    "stored",
  );
  // matchesBadExample：校验当前条件。
  if (
    record.id !== row.id ||
    record.workId !== row.work_id ||
    record.chapter !== row.chapter ||
    !matchesBadExample(record, row.work_id, request)
  ) {
    throw new StoreContractError("invalid-stored-data");
  }
  return record;
}

export class SqliteStore
  implements WorkStore, AuthorConfigRepository, BadExampleRepository
{
  private readonly db: Database.Database;

  constructor(path: string) {
    let db: Database.Database | undefined;
    try {
      // Exclusive creation sets private permissions without changing an
      // existing user's file. SQLite's in-memory path must not create a disk
      // file.
      if (path !== ":memory:") {
        try {
          // closeSync：释放当前资源。
          // openSync：处理当前步骤。
          closeSync(openSync(path, "wx", 0o600));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            throw error;
          }
        }
      }
      db = new Database(path, { timeout: 5000 });
      // initializeSqliteDatabase：处理当前步骤。
      initializeSqliteDatabase(db);
      // Initialization uses a short per-attempt busy handler. Restore the
      // established runtime wait for ordinary CAS/write transactions.
      // pragma：处理当前步骤。
      db.pragma("busy_timeout = 5000");
      this.db = db;
    } catch (error) {
      if (db?.open) {
        // close：释放当前资源。
        db.close();
      }
      if (
        error instanceof UnsupportedDatabaseError ||
        error instanceof SqliteInitializationError
      ) {
        throw error;
      }
      // getSqliteErrorCode：读取当前数据。
      throw new SqliteInitializationError(
        "open",
        getSqliteErrorCode(error) ?? null,
        1,
        "terminal",
      );
    }
  }

  close(): void {
    if (this.db.open) {
      // close：释放当前资源。
      this.db.close();
    }
  }

  private read<T>(fn: () => T): T {
    // deferred：处理当前步骤。
    // transaction：处理当前步骤。
    return this.db.transaction(fn).deferred();
  }
  private write<T>(fn: () => T): T {
    // immediate：处理当前步骤。
    // transaction：处理当前步骤。
    return this.db.transaction(fn).immediate();
  }

  private readWork(id: string): Work | undefined {
    // get：读取值。
    // prepare：处理当前步骤。
    const row = this.db.prepare("SELECT * FROM works WHERE id = ?").get(id) as
      | WorkRow
      | undefined;
    // workFromRow：处理当前步骤。
    return row && workFromRow(row);
  }

  private requireWork(id: string): void {
    // readWork：读取当前数据。
    if (!this.readWork(id)) {
      throw new KnownError("work-not-found", `work not found: ${id}`);
    }
  }

  private head(
    workId: string,
    kind: ArtifactKind,
    chapter?: number,
  ): Artifact | undefined {
    // get：读取值。
    // prepare：处理当前步骤。
    const row = this.db
      .prepare(
        "SELECT * FROM artifacts WHERE work_id = ? AND kind = ? AND chapter IS ? ORDER BY version DESC LIMIT 1",
      )
      .get(workId, kind, chapter ?? null) as ArtifactRow | undefined;
    // artifactFromRow：处理当前步骤。
    return row && artifactFromRow(row);
  }

  private assertPreconditions(
    workId: string,
    kind: ArtifactKind,
    chapter: number | undefined,
    conditions: readonly ArtifactPrecondition[] = [],
  ): void {
    for (const condition of conditions) {
      // assertBucketAddress：校验当前条件。
      assertBucketAddress(condition.kind, condition.chapter);
      // head：处理当前步骤。
      const head = this.head(workId, condition.kind, condition.chapter);
      const matches =
        condition.head === null
          ? head === undefined
          : head?.id === condition.head.artifactId &&
            head.version === condition.head.version &&
            head.humanStatus === condition.head.humanStatus;
      if (!matches) {
        throw new KnownError(
          condition.kind === kind && condition.chapter === chapter
            ? "version-conflict"
            : "upstream-changed",
          `artifact precondition changed: ${workId}/${condition.kind}`,
        );
      }
    }
  }

  private makeWork(input: WorkCreateRequest): Work {
    // validateStoreValue：校验当前条件。
    const parsed = validateStoreValue(workCreateRequestSchema, input, "input");
    // validateStoreValue：校验当前条件。
    // randomUUID：生成随机 ID。
    // trim：处理当前步骤。
    // slice：截取片段。
    // structuredClone：深拷贝数据。
    // toISOString：转换当前数据。
    return validateStoreValue(
      workSchema,
      {
        id: `work-${randomUUID()}`,
        title: parsed.title?.trim() || parsed.seed.slice(0, 20),
        seed: parsed.seed,
        config: structuredClone(emptyAgentConfig),
        createdAt: new Date().toISOString(),
      },
      "input",
    );
  }

  private insertWork(work: Work): void {
    // run：执行流程。
    // prepare：处理当前步骤。
    // stringify：序列化数据。
    this.db
      .prepare(
        "INSERT INTO works (id, title, seed, config, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        work.id,
        work.title,
        work.seed,
        JSON.stringify(work.config),
        work.createdAt,
      );
  }

  createWork(input: WorkCreateRequest): Work {
    // makeWork：构造当前数据。
    const work = this.makeWork(input);
    // write：写入当前结果。
    return this.write(() => {
      // insertWork：写入当前结果。
      this.insertWork(work);
      return work;
    });
  }

  createWorksIfEmpty(inputs: readonly WorkCreateRequest[]): boolean {
    // write：写入当前结果。
    return this.write(() => {
      // get：读取值。
      // prepare：处理当前步骤。
      if (this.db.prepare("SELECT 1 FROM works LIMIT 1").get()) {
        return false;
      }
      // map：转换数组元素。
      // makeWork：构造当前数据。
      const works = inputs.map((input) => this.makeWork(input));
      for (const work of works) {
        // insertWork：写入当前结果。
        this.insertWork(work);
      }
      return true;
    });
  }

  private readDetail(id: string): WorkDetail | undefined {
    // readWork：读取当前数据。
    const work = this.readWork(id);
    if (!work) {
      return undefined;
    }
    // all：处理当前步骤。
    // prepare：处理当前步骤。
    const rows = this.db
      .prepare(
        `SELECT a.* FROM artifacts a
      WHERE a.work_id = ? AND ${currentArtifactHead}
      ORDER BY (
        SELECT MIN(first.rowid) FROM artifacts first
        WHERE first.work_id = a.work_id AND first.kind = a.kind
          AND first.chapter IS a.chapter
      )`,
      )
      .all(id) as ArtifactRow[];
    // validateStoreValue：校验当前条件。
    // map：转换数组元素。
    return validateStoreValue(
      workDetailSchema,
      { ...work, artifacts: rows.map(artifactFromRow) },
      "stored",
    );
  }

  getWork(id: string): WorkDetail | undefined {
    // read：读取当前数据。
    // readDetail：读取当前数据。
    return this.read(() => this.readDetail(id));
  }

  private artifactVersion(query: {
    workId: string;
    kind: ArtifactKind;
    chapter: number | undefined;
    artifactId: string;
    version: number;
  }): Artifact | undefined {
    // get：读取值。
    // prepare：处理当前步骤。
    const row = this.db
      .prepare(
        `SELECT * FROM artifacts
      WHERE work_id = ? AND kind = ? AND chapter IS ?
        AND id = ? AND version = ?`,
      )
      .get(
        query.workId,
        query.kind,
        query.chapter ?? null,
        query.artifactId,
        query.version,
      ) as ArtifactRow | undefined;
    // artifactFromRow：处理当前步骤。
    return row === undefined ? undefined : artifactFromRow(row);
  }

  // bits:allow(BCS004): WorkStore 接口要求按位置传出版本坐标
  getArtifactVersion(
    workId: string,
    kind: ArtifactKind,
    chapter: number | undefined,
    artifactId: string,
    version: number,
  ): Artifact | undefined {
    // read：读取当前数据。
    // artifactVersion：处理当前步骤。
    return this.read(() =>
      this.artifactVersion({ workId, kind, chapter, artifactId, version }),
    );
  }

  listWorks(): WorkSummary[] {
    // read：读取当前数据。
    return this.read(() => {
      // all：处理当前步骤。
      // prepare：处理当前步骤。
      const workRows = this.db
        .prepare("SELECT * FROM works ORDER BY rowid")
        .all() as WorkRow[];
      // all：处理当前步骤。
      // prepare：处理当前步骤。
      const artifactRows = this.db
        .prepare(
          `SELECT a.* FROM artifacts a
        WHERE a.work_id IN (SELECT id FROM works) AND ${currentArtifactHead}`,
        )
        .all() as ArtifactRow[];
      const heads = new Map<string, Artifact[]>();
      for (const row of artifactRows) {
        // artifactFromRow：处理当前步骤。
        const artifact = artifactFromRow(row);
        // get：读取值。
        let bucket = heads.get(artifact.workId);
        if (!bucket) {
          bucket = [];
          // set：写入值。
          heads.set(artifact.workId, bucket);
        }
        // push：追加元素。
        bucket.push(artifact);
      }
      const summaries: WorkSummary[] = [];
      for (const row of workRows) {
        // get：读取值。
        const artifacts = heads.get(row.id) || [];
        // validateStoreValue：校验当前条件。
        // assign：合并对象。
        // workFromRow：处理当前步骤。
        const detail = validateStoreValue(
          workDetailSchema,
          Object.assign({}, workFromRow(row), { artifacts }),
          "stored",
        );
        // push：追加元素。
        // workSummary：处理当前步骤。
        summaries.push(workSummary(detail));
      }
      // validateStoreValue：校验当前条件。
      return validateStoreValue(workListResponseSchema, summaries, "stored");
    });
  }

  private insertArtifact(artifact: Artifact): void {
    // run：执行流程。
    // prepare：处理当前步骤。
    // stringify：序列化数据。
    // stringify：序列化数据。
    this.db
      .prepare(
        "INSERT INTO artifacts (id, work_id, kind, chapter, version, content, human_status, created_at, inputs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        artifact.id,
        artifact.workId,
        artifact.kind,
        artifact.chapter ?? null,
        artifact.version,
        JSON.stringify(artifact.content),
        artifact.humanStatus,
        artifact.createdAt,
        artifact.inputs === undefined ? null : JSON.stringify(artifact.inputs),
      );
  }

  appendArtifact(
    workId: string,
    kind: ArtifactKind,
    content: JsonValue,
    opts?: AppendOptions,
  ): Artifact {
    // structuredClone：深拷贝数据。
    const options = structuredClone(opts);
    // structuredClone：深拷贝数据。
    const storedContent = structuredClone(content);
    // write：写入当前结果。
    return this.write(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      const chapter = options?.chapter;
      // assertBucketAddress：校验当前条件。
      assertBucketAddress(kind, chapter);
      if (options?.humanStatus === "approved") {
        // assertDirectStatusAllowed：校验当前条件。
        assertDirectStatusAllowed(kind);
      }
      // assertPreconditions：校验当前条件。
      this.assertPreconditions(workId, kind, chapter, options?.preconditions);
      // head：处理当前步骤。
      const head = this.head(workId, kind, chapter);
      // validateStoreValue：校验当前条件。
      // randomUUID：生成随机 ID。
      // toISOString：转换当前数据。
      const artifact = validateStoreValue(
        artifactSchema,
        {
          id: `artifact-${randomUUID()}`,
          workId,
          kind,
          ...(chapter === undefined ? {} : { chapter }),
          version: (head?.version ?? 0) + 1,
          content: storedContent,
          humanStatus: options?.humanStatus ?? "pending",
          createdAt: new Date().toISOString(),
          ...(options?.inputs === undefined ? {} : { inputs: options.inputs }),
        },
        "input",
      );
      // insertArtifact：写入当前结果。
      this.insertArtifact(artifact);
      return artifact;
    });
  }

  finalizeArtifact(input: FinalizeArtifactInput): Artifact {
    // structuredClone：深拷贝数据。
    const request = structuredClone(input);
    // write：写入当前结果。
    return this.write(() => {
      const { workId, kind, chapter } = request;
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // assertBucketAddress：校验当前条件。
      assertBucketAddress(kind, chapter);
      // head：处理当前步骤。
      const head = this.head(workId, kind, chapter);
      if (
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
      // validateStoreValue：校验当前条件。
      const artifact = validateStoreValue(
        artifactSchema,
        { ...head, content: request.content, humanStatus: "approved" },
        "input",
      );
      // run：执行流程。
      // prepare：处理当前步骤。
      // stringify：序列化数据。
      this.db
        .prepare(
          "UPDATE artifacts SET content = ?, human_status = ? WHERE id = ?",
        )
        .run(
          JSON.stringify(artifact.content),
          artifact.humanStatus,
          artifact.id,
        );
      return artifact;
    });
  }

  saveArtifact(input: SaveArtifactInput): Artifact {
    // structuredClone：深拷贝数据。
    const request = structuredClone(input);
    // write：写入当前结果。
    return this.write(() => {
      const { workId, kind, chapter } = request;
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // assertBucketAddress：校验当前条件。
      assertBucketAddress(kind, chapter);
      // head：处理当前步骤。
      const head = this.head(workId, kind, chapter);
      if (
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
      // validateStoreValue：校验当前条件。
      // randomUUID：生成随机 ID。
      // toISOString：转换当前数据。
      const artifact = validateStoreValue(
        artifactSchema,
        {
          ...head,
          id: `artifact-${randomUUID()}`,
          version: head.version + 1,
          content: request.content,
          createdAt: new Date().toISOString(),
        },
        "input",
      );
      // insertArtifact：写入当前结果。
      this.insertArtifact(artifact);
      return artifact;
    });
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
    // write：写入当前结果。
    this.write(() => {
      // assertDirectStatusAllowed：校验当前条件。
      assertDirectStatusAllowed(kind);
      // assertBucketAddress：校验当前条件。
      assertBucketAddress(kind, opts?.chapter);
      // assertPreconditions：校验当前条件。
      this.assertPreconditions(
        workId,
        kind,
        opts?.chapter,
        opts?.preconditions,
      );
      // head：处理当前步骤。
      const head = this.head(workId, kind, opts?.chapter);
      if (!head) {
        throw new KnownError(
          "artifact-not-found",
          `artifact not found: ${workId}/${kind}`,
        );
      }
      // validateStoreValue：校验当前条件。
      const artifact = validateStoreValue(
        artifactSchema,
        { ...head, humanStatus: status },
        "input",
      );
      // run：执行流程。
      // prepare：处理当前步骤。
      this.db
        .prepare("UPDATE artifacts SET human_status = ? WHERE id = ?")
        .run(artifact.humanStatus, artifact.id);
    });
  }

  private extensionRecord(
    workId: string,
    requestId: string,
  ): SettingExtensionProposalRecord | undefined {
    // get：读取值。
    // prepare：处理当前步骤。
    const row = this.db
      .prepare(
        "SELECT record FROM setting_extension_proposals WHERE work_id = ? AND request_id = ?",
      )
      .get(workId, requestId) as { record: string } | undefined;
    if (!row) {
      return undefined;
    }
    // validateStoreValue：校验当前条件。
    // parseJson：解析当前输入。
    const record = validateStoreValue(
      settingExtensionProposalRecordSchema,
      parseJson(row.record),
      "stored",
    );
    if (record.workId !== workId || record.requestId !== requestId) {
      throw new StoreContractError("invalid-stored-data");
    }
    return record;
  }

  private putExtensionRecord(record: SettingExtensionProposalRecord): void {
    // validateStoreValue：校验当前条件。
    const snapshot = validateStoreValue(
      settingExtensionProposalRecordSchema,
      record,
      "input",
    );
    // run：执行流程。
    // prepare：处理当前步骤。
    // stringify：序列化数据。
    this.db
      .prepare(
        `INSERT INTO setting_extension_proposals (work_id, request_id, record) VALUES (?, ?, ?)
      ON CONFLICT (work_id, request_id) DO UPDATE SET record = excluded.record`,
      )
      .run(snapshot.workId, snapshot.requestId, JSON.stringify(snapshot));
  }

  private validateExtensionCandidate(
    record: SettingExtensionProposalRecord | undefined,
  ): void {
    if (!record || record.status !== "approved") {
      return;
    }
    // artifactVersion：处理当前步骤。
    const candidate =
      record.candidate === null
        ? undefined
        : this.artifactVersion({
            workId: record.workId,
            kind: "setting",
            chapter: undefined,
            artifactId: record.candidate.artifactId,
            version: record.candidate.version,
          });
    // artifactVersion：处理当前步骤。
    const base = this.artifactVersion({
      workId: record.workId,
      kind: "setting",
      chapter: undefined,
      artifactId: record.expectedBase.artifactId,
      version: record.expectedBase.version,
    });
    // isValidApprovedExtensionCandidate：校验当前条件。
    if (!isValidApprovedExtensionCandidate(record, candidate, base)) {
      throw new StoreContractError("invalid-stored-data");
    }
  }

  proposeSettingExtension(
    workId: string,
    request: SettingExtensionProposeRequest,
  ): SettingExtensionReceipt {
    // write：写入当前结果。
    return this.write(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // readDetail：读取当前数据。
      const work = this.readDetail(workId)!;
      // extensionRecord：处理当前步骤。
      const prior = this.extensionRecord(workId, request.requestId);
      // proposeExtension：处理当前步骤。
      const record = proposeExtension(work, request, prior);
      if (record !== prior) {
        // putExtensionRecord：写入当前结果。
        this.putExtensionRecord(record);
      } else {
        // validateExtensionCandidate：校验当前条件。
        this.validateExtensionCandidate(prior);
      }
      // extensionReceipt：处理当前步骤。
      return extensionReceipt(record, "propose");
    });
  }

  private actSettingExtension(
    workId: string,
    request: SettingExtensionActionRequest,
    operation: "approve" | "cancel",
  ): SettingExtensionReceipt {
    // write：写入当前结果。
    return this.write(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // All current heads are read under the same IMMEDIATE writer transaction
      // as both writes; a route/service pre-read cannot satisfy this guard.
      // readDetail：读取当前数据。
      const work = this.readDetail(workId)!;
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
      if (plan.artifact) {
        // insertArtifact：写入当前结果。
        this.insertArtifact(plan.artifact);
      }
      // putExtensionRecord：写入当前结果。
      this.putExtensionRecord(plan.record);
      // extensionReceipt：处理当前步骤。
      return extensionReceipt(plan.record, operation);
    });
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
    // read：读取当前数据。
    return this.read(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // extensionRecord：处理当前步骤。
      const record = this.extensionRecord(workId, requestId);
      // validateExtensionCandidate：校验当前条件。
      this.validateExtensionCandidate(record);
      // extensionResource：处理当前步骤。
      // readDetail：读取当前数据。
      return extensionResource(this.readDetail(workId)!, requestId, record);
    });
  }

  getAuthorConfig(workId: string): AuthorConfigReceipt | undefined {
    // read：读取当前数据。
    return this.read(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // get：读取值。
      // prepare：处理当前步骤。
      const row = this.db
        .prepare(
          "SELECT * FROM author_configs WHERE work_id = ? ORDER BY revision DESC LIMIT 1",
        )
        .get(workId) as
        | { revision: number; request_id: string; document: string }
        | undefined;
      // validateStoreValue：校验当前条件。
      // parseJson：解析当前输入。
      return (
        row &&
        validateStoreValue(
          authorConfigReceiptSchema,
          {
            workId,
            revision: row.revision,
            requestId: row.request_id,
            document: parseJson(row.document),
          },
          "stored",
        )
      );
    });
  }

  private authorConfigReplay(
    workId: string,
    request: AuthorConfigSave,
  ): AuthorConfigReceipt | undefined {
    // get：读取值。
    // prepare：处理当前步骤。
    const prior = this.db
      .prepare("SELECT * FROM author_configs WHERE work_id = ? AND request_id = ?")
      .get(workId, request.requestId) as
      | { revision: number; expected_revision: number; document: string }
      | undefined;
    if (!prior) {
      return undefined;
    }
    // validateStoreValue：校验当前条件。
    // parseJson：解析当前输入。
    const receipt = validateStoreValue(
      authorConfigReceiptSchema,
      {
        workId,
        revision: prior.revision,
        requestId: request.requestId,
        document: parseJson(prior.document),
      },
      "stored",
    );
    // stringify：序列化数据。
    // stringify：序列化数据。
    if (
      prior.expected_revision !== request.expectedRevision ||
      JSON.stringify(receipt.document) !== JSON.stringify(request.document)
    ) {
      throw new KnownError("version-conflict", "request identity already used");
    }
    return receipt;
  }

  private insertAuthorConfig(
    workId: string,
    request: AuthorConfigSave,
  ): AuthorConfigReceipt {
    // getAuthorConfig：读取当前数据。
    const current = this.getAuthorConfig(workId)?.revision ?? 0;
    if (current !== request.expectedRevision) {
      throw new KnownError(
        "version-conflict",
        "configuration revision changed",
      );
    }
    // validateStoreValue：校验当前条件。
    const receipt = validateStoreValue(
      authorConfigReceiptSchema,
      {
        workId,
        revision: current + 1,
        requestId: request.requestId,
        document: request.document,
      },
      "input",
    );
    // run：执行流程。
    // prepare：处理当前步骤。
    // stringify：序列化数据。
    this.db
      .prepare(
        "INSERT INTO author_configs (work_id, revision, request_id, expected_revision, document) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        workId,
        receipt.revision,
        request.requestId,
        request.expectedRevision,
        JSON.stringify(receipt.document),
      );
    return receipt;
  }

  saveAuthorConfig(
    workId: string,
    input: AuthorConfigSave,
  ): AuthorConfigReceipt {
    // validateStoreValue：校验当前条件。
    const request = validateStoreValue(authorConfigSaveSchema, input, "input");
    // write：写入当前结果。
    return this.write(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // authorConfigReplay：处理当前步骤。
      const replay = this.authorConfigReplay(workId, request);
      if (replay) {
        return replay;
      }
      // insertAuthorConfig：写入当前结果。
      return this.insertAuthorConfig(workId, request);
    });
  }

  getAuthorConfigReceipt(
    workId: string,
    requestId: string,
  ): AuthorConfigReceipt | undefined {
    // read：读取当前数据。
    return this.read(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // get：读取值。
      // prepare：处理当前步骤。
      const row = this.db
        .prepare(
          "SELECT * FROM author_configs WHERE work_id = ? AND request_id = ?",
        )
        .get(workId, requestId) as
        | { revision: number; document: string }
        | undefined;
      // validateStoreValue：校验当前条件。
      // parseJson：解析当前输入。
      return (
        row &&
        validateStoreValue(
          authorConfigReceiptSchema,
          {
            workId,
            requestId,
            revision: row.revision,
            document: parseJson(row.document),
          },
          "stored",
        )
      );
    });
  }

  listAgentFiles(workId: string): AgentFile[] {
    // read：读取当前数据。
    return this.read(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // all：处理当前步骤。
      // prepare：处理当前步骤。
      const rows = this.db
        .prepare("SELECT * FROM agent_files WHERE work_id = ? ORDER BY rowid")
        .all(workId) as { id: string; work_id: string; metadata: string }[];
      // map：转换数组元素。
      return rows.map((row) => {
        // validateStoreValue：校验当前条件。
        // parseJson：解析当前输入。
        const file = validateStoreValue(
          agentFileSchema,
          parseJson(row.metadata),
          "stored",
        );
        if (file.id !== row.id || file.workId !== row.work_id) {
          throw new StoreContractError("invalid-stored-data");
        }
        return file;
      });
    });
  }

  putAgentFile(input: AgentFile): AgentFile {
    // validateStoreValue：校验当前条件。
    const file = validateStoreValue(agentFileSchema, input, "input");
    // write：写入当前结果。
    return this.write(() => {
      // requireWork：校验当前条件。
      this.requireWork(file.workId);
      // get：读取值。
      // prepare：处理当前步骤。
      const existing = this.db
        .prepare("SELECT * FROM agent_files WHERE id = ?")
        .get(file.id) as { metadata: string } | undefined;
      if (existing) {
        // validateStoreValue：校验当前条件。
        // parseJson：解析当前输入。
        const prior = validateStoreValue(
          agentFileSchema,
          parseJson(existing.metadata),
          "stored",
        );
        if (
          prior.workId !== file.workId ||
          prior.sha256 !== file.sha256 ||
          prior.kind !== file.kind
        ) {
          throw new KnownError(
            "version-conflict",
            "file request identity already used",
          );
        }
        return prior;
      }
      // listAgentFiles：读取当前数据。
      if (
        this.listAgentFiles(file.workId).length >=
        authorConfigLimits.filesPerWork
      ) {
        throw new KnownError("config-invalid", "file library limit exceeded");
      }
      // run：执行流程。
      // prepare：处理当前步骤。
      // stringify：序列化数据。
      this.db
        .prepare(
          "INSERT INTO agent_files (id, work_id, metadata) VALUES (?, ?, ?)",
        )
        .run(file.id, file.workId, JSON.stringify(file));
      return file;
    });
  }

  private badExampleReplay(
    workId: string,
    request: BadExampleRequest,
  ): BadExample | undefined {
    // get：读取值。
    // prepare：处理当前步骤。
    const prior = this.db
      .prepare("SELECT * FROM bad_examples WHERE id = ?")
      .get(request.requestId) as BadExampleRow | undefined;
    if (!prior) {
      return undefined;
    }
    // badExampleFromRow：处理当前步骤。
    const record = badExampleFromRow(prior);
    // matchesBadExample：校验当前条件。
    if (!matchesBadExample(record, workId, request)) {
      throw new KnownError("version-conflict", "request identity already used");
    }
    return record;
  }

  private assertBadExampleSource(
    workId: string,
    request: BadExampleRequest,
  ): void {
    // get：读取值。
    // prepare：处理当前步骤。
    const row = this.db
      .prepare("SELECT * FROM artifacts WHERE id = ? AND work_id = ?")
      .get(request.sourceArtifactId, workId) as ArtifactRow | undefined;
    // artifactFromRow：处理当前步骤。
    const artifact = row && artifactFromRow(row);
    if (
      !artifact ||
      artifact.kind !== "prose" ||
      artifact.chapter !== request.chapter ||
      artifact.version !== request.sourceVersion
    ) {
      throw new KnownError("bad-example-invalid", "selection source does not match");
    }
    const text = (artifact.content as { text: string }).text;
    // slice：截取片段。
    // digest：处理当前步骤。
    // update：写入当前结果。
    // createHash：构造当前数据。
    if (
      request.end > text.length ||
      text.slice(request.start, request.end) !== request.text ||
      createHash("sha256").update(text).digest("hex") !== request.sourceHash
    ) {
      throw new KnownError(
        "bad-example-invalid",
        "selection source content changed",
      );
    }
  }

  markBadExample(workId: string, input: BadExampleRequest): BadExample {
    // safeParse：校验并解析输入。
    const parsed = badExampleRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new KnownError(
        "bad-example-invalid",
        "invalid bad-example selection",
      );
    }
    const request = parsed.data;
    // write：写入当前结果。
    return this.write(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // badExampleReplay：处理当前步骤。
      const replay = this.badExampleReplay(workId, request);
      if (replay) {
        return replay;
      }
      // assertBadExampleSource：校验当前条件。
      this.assertBadExampleSource(workId, request);
      const { requestId, ...source } = request;
      // validateStoreValue：校验当前条件。
      // toISOString：转换当前数据。
      const record = validateStoreValue(
        badExampleSchema,
        {
          id: requestId,
          workId,
          ...source,
          createdAt: new Date().toISOString(),
        },
        "input",
      );
      // run：执行流程。
      // prepare：处理当前步骤。
      // stringify：序列化数据。
      // stringify：序列化数据。
      this.db
        .prepare(
          "INSERT INTO bad_examples (id, work_id, chapter, record, request) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          record.id,
          workId,
          record.chapter,
          JSON.stringify(record),
          JSON.stringify(request),
        );
      return record;
    });
  }

  getBadExample(workId: string, id: string): BadExample | undefined {
    // read：读取当前数据。
    return this.read(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      // get：读取值。
      // prepare：处理当前步骤。
      const row = this.db
        .prepare("SELECT * FROM bad_examples WHERE id = ? AND work_id = ?")
        .get(id, workId) as BadExampleRow | undefined;
      // badExampleFromRow：处理当前步骤。
      return row && badExampleFromRow(row);
    });
  }

  listBadExamples(workId: string, input: BadExampleQuery): BadExamplePage {
    // safeParse：校验并解析输入。
    const query = badExampleQuerySchema.safeParse(input);
    if (!query.success) {
      throw new KnownError("bad-example-invalid", "invalid bad-example query");
    }
    // read：读取当前数据。
    return this.read(() => {
      // requireWork：校验当前条件。
      this.requireWork(workId);
      const { chapter, after } = query.data;
      // all：处理当前步骤。
      // prepare：处理当前步骤。
      const rows = this.db
        .prepare(
          "SELECT *, rowid AS cursor FROM bad_examples WHERE work_id = ? AND (? IS NULL OR chapter = ?) AND rowid > ? ORDER BY rowid LIMIT ?",
        )
        .all(
          workId,
          chapter ?? null,
          chapter ?? null,
          after ?? 0,
          badExampleLimits.page + 1,
        ) as BadExampleRow[];
      // slice：截取片段。
      const page = rows.slice(0, badExampleLimits.page);
      // validateStoreValue：校验当前条件。
      // map：转换数组元素。
      // at：处理当前步骤。
      return validateStoreValue(
        badExamplePageSchema,
        {
          workId,
          ...query.data,
          items: page.map(badExampleFromRow),
          ...(rows.length > badExampleLimits.page
            ? { nextCursor: page.at(-1)!.cursor }
            : {}),
        },
        "stored",
      );
    });
  }
}
