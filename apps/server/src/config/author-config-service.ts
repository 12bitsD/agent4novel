import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isAlias, parseDocument, visit } from "yaml";
import {
  agentFileSchema,
  agentFileUploadSchema,
  authorConfigDocumentSchema,
  authorConfigLimits,
  authorConfigSaveSchema,
  authorConfigViewSchema,
  authorStepIds,
  emptyAuthorConfig,
  managedAgentFileText,
  providerForModel,
  type AgentConfig,
  type AgentFile,
  type AgentFileUpload,
  type AuthorConfigDocument,
  type AuthorConfigReceipt,
  type AuthorConfigSave,
  type WorkDetail,
} from "@agent4novel/contracts";
import { KnownError } from "../errors.js";
import { modelRuntime, type ModelRuntime } from "../steps/llm.js";
import { systemFor } from "../steps/llm-call.js";
import type { WorkStore } from "../store/work-store.js";
import type { AuthorConfigRepository } from "./author-config-repository.js";

// digest：处理当前步骤。
// update：写入当前结果。
// createHash：构造当前数据。
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const invalid = () =>
  new KnownError("config-invalid", "invalid author configuration or file");
const unavailable = () =>
  new KnownError(
    "agent-file-unavailable",
    "selected agent file is unavailable or changed",
  );
type SelectedConfig = AuthorConfigDocument["defaults"];
type AuthorStepId = (typeof authorStepIds)[number];

const preferenceSteps: Record<string, readonly string[]> = {
  style: ["prose"],
  genre: ["creative", "outline", "setting", "beat", "prose"],
  payoff: ["creative", "outline", "beat", "prose"],
};

function savedVersion(saved: AuthorConfigReceipt | undefined) {
  // emptyAuthorConfig：处理当前步骤。
  return {
    document: saved ? saved.document : emptyAuthorConfig(),
    revision: saved ? saved.revision : 0,
  };
}

function validMetadataObject(value: unknown): boolean {
  // isArray：检查数组类型。
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  // every：检查全部匹配。
  // values：处理当前步骤。
  return Object.values(value).every((item) => typeof item === "string");
}

function validateOptionalMetadata(meta: Record<string, unknown>): void {
  if (meta.license !== undefined && typeof meta.license !== "string") {
    // invalid：处理当前步骤。
    throw invalid();
  }
  if (
    meta.compatibility !== undefined &&
    (typeof meta.compatibility !== "string" || meta.compatibility.length > 500)
  ) {
    // invalid：处理当前步骤。
    throw invalid();
  }
  if (
    meta["allowed-tools"] !== undefined &&
    typeof meta["allowed-tools"] !== "string"
  ) {
    // invalid：处理当前步骤。
    throw invalid();
  }
  if (meta.metadata === undefined) {
    return;
  }
  // validMetadataObject：校验当前条件。
  if (!validMetadataObject(meta.metadata)) {
    // invalid：处理当前步骤。
    throw invalid();
  }
}

function skillMetadata(yaml: ReturnType<typeof parseDocument>) {
  // toJS：转换当前数据。
  const meta = yaml.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
  // isArray：检查数组类型。
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    // invalid：处理当前步骤。
    throw invalid();
  }
  // safeParse：校验并解析输入。
  // pick：处理当前步骤。
  const checked = agentFileSchema
    .pick({ name: true, description: true })
    .safeParse({ name: meta.name, description: meta.description });
  // trim：处理当前步骤。
  if (!checked.success || !checked.data.description.trim()) {
    // invalid：处理当前步骤。
    throw invalid();
  }
  // validateOptionalMetadata：校验当前条件。
  validateOptionalMetadata(meta);
  return checked.data;
}

function skillParts(text: string): RegExpExecArray {
  // byteLength：计算字节长度。
  // decode：处理当前步骤。
  // from：构造数组。
  if (
    Buffer.byteLength(text) > authorConfigLimits.fileBytes ||
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(text)) !== text
  ) {
    // invalid：处理当前步骤。
    throw invalid();
  }
  // exec：处理当前步骤。
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  // byteLength：计算字节长度。
  // trim：处理当前步骤。
  if (
    !match ||
    Buffer.byteLength(match[1]!) > authorConfigLimits.metadataBytes ||
    !match[2]!.trim()
  ) {
    // invalid：处理当前步骤。
    throw invalid();
  }
  return match;
}

type ParsedSkill = {
  name: string;
  description: string;
  body: string;
};

function parseSkill(text: string): ParsedSkill {
  // skillParts：处理当前步骤。
  const match = skillParts(text);
  try {
    // parseDocument：解析当前输入。
    const yaml = parseDocument(match[1]!, {
      strict: true,
      uniqueKeys: true,
      stringKeys: true,
    });
    if (yaml.errors.length) {
      // invalid：处理当前步骤。
      throw invalid();
    }
    // visit：处理当前步骤。
    visit(yaml, (_key, node) => {
      // isAlias：校验当前条件。
      if (isAlias(node)) {
        // invalid：处理当前步骤。
        throw invalid();
      }
    });
    // skillMetadata：处理当前步骤。
    return { ...skillMetadata(yaml), body: match[2]! };
  } catch {
    // invalid：处理当前步骤。
    throw invalid();
  }
}

export class AuthorConfigService {
  private readonly root: string;
  private readonly runtime: ModelRuntime;
  private readonly onSaved: (workId: string) => void;
  constructor(
    private readonly store: WorkStore,
    private readonly repository: AuthorConfigRepository,
    dataDir: string,
    options: {
      runtime?: ModelRuntime;
      onSaved?: (workId: string) => void;
    } = {},
  ) {
    this.runtime = options.runtime ?? modelRuntime;
    this.onSaved = options.onSaved ?? (() => {});
    // resolve：完成异步调用。
    this.root = resolve(dataDir, "prompts");
  }
  private path(file: AgentFile): string {
    // join：拼接文本。
    // hash：校验当前条件。
    return join(this.root, hash(file.workId), file.id, file.name, "SKILL.md");
  }
  private ensureDirectory(path: string): void {
    // relative：处理当前步骤。
    const rel = relative(this.root, path);
    // startsWith：执行当前流程。
    // startsWith：执行当前流程。
    if (rel.startsWith("..") || rel.startsWith(sep)) {
      // unavailable：处理当前步骤。
      throw unavailable();
    }
    let current = this.root;
    // split：处理当前步骤。
    for (const part of ["", ...rel.split(sep)]) {
      if (part) {
        // join：拼接文本。
        current = join(current, part);
      }
      try {
        // mkdirSync：处理当前步骤。
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
      // lstatSync：处理当前步骤。
      const stat = lstatSync(current);
      // isSymbolicLink：校验当前条件。
      // isDirectory：校验当前条件。
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        // unavailable：处理当前步骤。
        throw unavailable();
      }
    }
  }
  private assertContained(path: string): void {
    // relative：处理当前步骤。
    const rel = relative(this.root, path);
    // startsWith：执行当前流程。
    // startsWith：执行当前流程。
    if (
      rel.startsWith(`..${sep}`) ||
      rel === ".." ||
      rel === "" ||
      rel.startsWith(sep)
    ) {
      // unavailable：处理当前步骤。
      throw unavailable();
    }
    let current = this.root;
    // Every managed component is private and must not be a symlink.
    // isSymbolicLink：校验当前条件。
    // lstatSync：处理当前步骤。
    if (lstatSync(current).isSymbolicLink()) {
      // unavailable：处理当前步骤。
      throw unavailable();
    }
    // split：处理当前步骤。
    for (const part of rel.split(sep)) {
      // join：拼接文本。
      current = join(current, part);
      // isSymbolicLink：校验当前条件。
      // lstatSync：处理当前步骤。
      if (lstatSync(current).isSymbolicLink()) {
        // unavailable：处理当前步骤。
        throw unavailable();
      }
    }
    // startsWith：执行当前流程。
    // relative：处理当前步骤。
    // realpathSync：处理当前步骤。
    // realpathSync：处理当前步骤。
    if (
      relative(realpathSync(this.root), realpathSync(path)).startsWith("..")
    ) {
      // unavailable：处理当前步骤。
      throw unavailable();
    }
  }
  private readText(file: AgentFile): string {
    let fd: number | undefined;
    try {
      // path：处理当前步骤。
      const path = this.path(file);
      // assertContained：校验当前条件。
      this.assertContained(path);
      // openSync：处理当前步骤。
      fd = openSync(path, "r");
      // fstatSync：处理当前步骤。
      const stat = fstatSync(fd);
      // isFile：校验当前条件。
      if (
        !stat.isFile() ||
        stat.size !== file.byteLength ||
        stat.size > authorConfigLimits.fileBytes
      ) {
        // unavailable：处理当前步骤。
        throw unavailable();
      }
      // alloc：处理当前步骤。
      const buffer = Buffer.alloc(authorConfigLimits.fileBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        // readSync：读取当前数据。
        const n = readSync(fd, buffer, length, buffer.length - length, null);
        if (!n) {
          break;
        }
        length += n;
      }
      if (length !== file.byteLength) {
        // unavailable：处理当前步骤。
        throw unavailable();
      }
      // decode：处理当前步骤。
      // subarray：处理当前步骤。
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, length),
      );
      // hash：校验当前条件。
      if (hash(text) !== file.sha256) {
        // unavailable：处理当前步骤。
        throw unavailable();
      }
      return text;
    } catch {
      // unavailable：处理当前步骤。
      throw unavailable();
    } finally {
      if (fd !== undefined) {
        // closeSync：释放当前资源。
        closeSync(fd);
      }
    }
  }
  readFile(workId: string, id: string) {
    // find：查找元素。
    // listAgentFiles：读取当前数据。
    const file = this.repository
      .listAgentFiles(workId)
      .find((f) => f.id === id);
    if (!file) {
      // unavailable：处理当前步骤。
      throw unavailable();
    }
    // readText：读取当前数据。
    return { file, text: this.readText(file) };
  }
  private reusableFile(
    files: AgentFile[],
    file: AgentFile,
  ): AgentFile | undefined {
    // find：查找元素。
    const old = files.find((candidate) => candidate.id === file.id);
    if (!old) {
      return undefined;
    }
    if (old.sha256 !== file.sha256 || old.kind !== file.kind) {
      throw new KnownError(
        "version-conflict",
        "file request identity already used",
      );
    }
    // readText：读取当前数据。
    this.readText(old);
    return old;
  }

  private writePublishedFile(
    file: AgentFile,
    text: string,
    path: string,
    temporary: string,
  ): void {
    let created = false;
    try {
      // openSync：处理当前步骤。
      const fd = openSync(temporary, "wx", 0o600);
      created = true;
      try {
        // writeFileSync：写入当前结果。
        writeFileSync(fd, text, "utf8");
        // fsyncSync：处理当前步骤。
        fsyncSync(fd);
      } finally {
        // closeSync：释放当前资源。
        closeSync(fd);
      }
      try {
        // linkSync：处理当前步骤。
        linkSync(temporary, path);
      } catch (publicationError) {
        if ((publicationError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw publicationError;
        }
        // readText：读取当前数据。
        this.readText(file);
      }
      // unlinkSync：处理当前步骤。
      unlinkSync(temporary);
      created = false;
      // openSync：处理当前步骤。
      // dirname：处理当前步骤。
      const directory = openSync(dirname(path), "r");
      try {
        // fsyncSync：处理当前步骤。
        fsyncSync(directory);
      } finally {
        // closeSync：释放当前资源。
        closeSync(directory);
      }
    } finally {
      if (created) {
        try {
          // unlinkSync：处理当前步骤。
          unlinkSync(temporary);
        } catch (cleanupError) {
          void cleanupError;
        }
      }
    }
  }

  private publish(file: AgentFile, text: string): void {
    // path：处理当前步骤。
    const path = this.path(file);
    // randomUUID：生成随机 ID。
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      // ensureDirectory：处理当前步骤。
      // dirname：处理当前步骤。
      this.ensureDirectory(dirname(path));
      // assertContained：校验当前条件。
      // dirname：处理当前步骤。
      this.assertContained(dirname(path));
      try {
        // lstatSync：处理当前步骤。
        const existing = lstatSync(path);
        // isFile：校验当前条件。
        // isSymbolicLink：校验当前条件。
        if (!existing.isFile() || existing.isSymbolicLink()) {
          // unavailable：处理当前步骤。
          throw unavailable();
        }
        // readText：读取当前数据。
        this.readText(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
        // writePublishedFile：写入当前结果。
        this.writePublishedFile(file, text, path, temporary);
      }
    } catch (error) {
      if (error instanceof KnownError) {
        throw error;
      }
      // unavailable：处理当前步骤。
      throw unavailable();
    }
  }

  upload(workId: string, input: AgentFileUpload): AgentFile {
    // safeParse：校验并解析输入。
    const parsed = agentFileUploadSchema.safeParse(input);
    if (!parsed.success) {
      // invalid：处理当前步骤。
      throw invalid();
    }
    const request = parsed.data;
    // managedAgentFileText：处理当前步骤。
    const text = managedAgentFileText(request.kind, request.text);
    // parseSkill：解析当前输入。
    const meta = parseSkill(text);
    // parse：解析输入。
    // hash：校验当前条件。
    // byteLength：计算字节长度。
    // toISOString：转换当前数据。
    const file = agentFileSchema.parse({
      id: request.requestId,
      workId,
      kind: request.kind,
      name: meta.name,
      description: meta.description,
      sha256: hash(text),
      byteLength: Buffer.byteLength(text),
      createdAt: new Date().toISOString(),
    });
    // listAgentFiles：读取当前数据。
    const files = this.repository.listAgentFiles(workId);
    // reusableFile：处理当前步骤。
    const reusable = this.reusableFile(files, file);
    if (reusable) {
      return reusable;
    }
    if (files.length >= authorConfigLimits.filesPerWork) {
      // invalid：处理当前步骤。
      throw invalid();
    }
    // publish：处理当前步骤。
    this.publish(file, text);
    // putAgentFile：写入当前结果。
    return this.repository.putAgentFile(file);
  }
  private selectedFiles(files: AgentFile[], selected: SelectedConfig) {
    const find = (fileId: string, kind: AgentFile["kind"]) => {
      // find：查找元素。
      const file = files.find(
        (candidate) => candidate.id === fileId && candidate.kind === kind,
      );
      if (!file) {
        // invalid：处理当前步骤。
        throw invalid();
      }
      return file;
    };
    // find：查找元素。
    const prompt = selected.systemPromptRef
      ? find(selected.systemPromptRef, "prompt")
      : null;
    // map：转换数组元素。
    // find：查找元素。
    const skills = (selected.skills || []).map((fileId) =>
      find(fileId, "skill"),
    );
    return { prompt, skills };
  }

  private stepGuidance(
    context: {
      document: AuthorConfigDocument;
      legacy: AgentConfig;
      readParsed: (file: AgentFile) => ReturnType<typeof parseSkill>;
    },
    selection: {
      id: AuthorStepId;
      selected: SelectedConfig;
      prompt: AgentFile | null;
      skills: AgentFile[];
    },
  ) {
    const appliedPreferences: Record<string, string> = {};
    // entries：读取对象条目。
    for (const [key, value] of Object.entries(context.document.preferences)) {
      // includes：检查包含关系。
      if (
        value &&
        preferenceSteps[key as keyof typeof preferenceSteps].includes(
          selection.id,
        )
      ) {
        appliedPreferences[key] = value;
      }
    }
    const guidance: string[] = [];
    // keys：读取对象键。
    if (Object.keys(appliedPreferences).length) {
      // push：追加元素。
      // stringify：序列化数据。
      guidance.push(
        `Author preferences: ${JSON.stringify(appliedPreferences)}`,
      );
    }
    if (selection.prompt) {
      // push：追加元素。
      // readParsed：读取当前数据。
      guidance.push(context.readParsed(selection.prompt).body);
    } else if (
      selection.selected.systemPromptRef !== null &&
      context.legacy.systemPrompt
    ) {
      // push：追加元素。
      guidance.push(context.legacy.systemPrompt);
    }
    for (const file of selection.skills) {
      // push：追加元素。
      // readParsed：读取当前数据。
      guidance.push(`Skill ${file.name}:\n${context.readParsed(file).body}`);
    }
    // join：拼接文本。
    return { appliedPreferences, system: guidance.join("\n\n") };
  }

  private configFiles(prompt: AgentFile | null, skills: AgentFile[]) {
    const files = [];
    if (prompt) {
      // push：追加元素。
      files.push({ id: prompt.id, sha256: prompt.sha256 });
    }
    for (const file of skills) {
      // push：追加元素。
      files.push({ id: file.id, sha256: file.sha256 });
    }
    return files;
  }

  private validateGeneration(config: AgentConfig, model: string) {
    try {
      // generationSettings：处理当前步骤。
      const generation = this.runtime.generationSettings(config).parameters;
      if (this.runtime.mode === "live") {
        // languageModel：处理当前步骤。
        this.runtime.languageModel(model);
      }
      return generation;
    } catch {
      // invalid：处理当前步骤。
      throw invalid();
    }
  }

  private validateProvider(model: string) {
    // providerForModel：处理当前步骤。
    const provider = providerForModel(model);
    if (!provider) {
      // invalid：处理当前步骤。
      throw invalid();
    }
    return provider;
  }

  private selectedStepConfig(
    selectionContext: {
      document: AuthorConfigDocument;
      legacy: AgentConfig;
    },
    id: AuthorStepId,
  ) {
    // assign：合并对象。
    const selected = Object.assign(
      {},
      selectionContext.document.defaults,
      selectionContext.document.steps[id],
    );
    let model = selected.model;
    if (!model) {
      model = selectionContext.legacy.model;
    }
    if (!model) {
      model = this.runtime.defaultModelId;
    }
    // assign：合并对象。
    const config: AgentConfig = Object.assign(
      {},
      selectionContext.legacy,
      selected,
      { model },
    );
    delete (config as Record<string, unknown>).systemPromptRef;
    config.skills = [];
    config.tools = [];
    return { config, model, selected };
  }

  private applyStepGuidance(
    id: AuthorStepId,
    input: {
      revision: number;
      config: AgentConfig;
      selectedFiles: ReturnType<AuthorConfigService["selectedFiles"]>;
      guidance: ReturnType<AuthorConfigService["stepGuidance"]>;
    },
  ) {
    if (input.guidance.system.length > authorConfigLimits.systemChars) {
      // invalid：处理当前步骤。
      throw invalid();
    }
    input.config.systemPrompt = input.guidance.system;
    input.config.configRevision = input.revision;
    // systemFor：处理当前步骤。
    systemFor(id, input.config);
    // configFiles：处理当前步骤。
    input.config.configFiles = this.configFiles(
      input.selectedFiles.prompt,
      input.selectedFiles.skills,
    );
  }

  private resolveStep(
    resolutionContext: {
      document: AuthorConfigDocument;
      legacy: AgentConfig;
      revision: number;
      files: AgentFile[];
      readParsed: (file: AgentFile) => ReturnType<typeof parseSkill>;
    },
    id: AuthorStepId,
  ) {
    // selectedStepConfig：读取当前数据。
    const selection = this.selectedStepConfig(resolutionContext, id);
    // selectedFiles：读取当前数据。
    const selectedFiles = this.selectedFiles(
      resolutionContext.files,
      selection.selected,
    );
    // stepGuidance：处理当前步骤。
    const guidance = this.stepGuidance(
      resolutionContext,
      {
        id,
        selected: selection.selected,
        prompt: selectedFiles.prompt,
        skills: selectedFiles.skills,
      },
    );
    // applyStepGuidance：处理当前步骤。
    this.applyStepGuidance(id, {
      revision: resolutionContext.revision,
      config: selection.config,
      selectedFiles,
      guidance,
    });
    // validateGeneration：校验当前条件。
    const generation = this.validateGeneration(
      selection.config,
      selection.model,
    );
    // validateProvider：校验当前条件。
    const provider = this.validateProvider(selection.model);
    return {
      config: selection.config,
      model: selection.model,
      provider,
      generation,
      guidance,
      prompt: selectedFiles.prompt,
      skills: selectedFiles.skills,
    };
  }

  private effectiveStep(
    id: AuthorStepId,
    resolved: ReturnType<AuthorConfigService["resolveStep"]>,
  ) {
    return {
      id,
      model: resolved.model,
      provider: resolved.provider,
      configured: this.runtime.mode === "live",
      executionMode: this.runtime.mode,
      generation: resolved.generation,
      appliedPreferences: resolved.guidance.appliedPreferences,
      systemPrompt: resolved.prompt,
      skills: resolved.skills,
      tools: [],
      directionCount: resolved.config.directionCount ?? 2,
    };
  }

  private resolve(
    work: WorkDetail,
    document: AuthorConfigDocument,
    revision: number,
  ) {
    // listAgentFiles：读取当前数据。
    const files = this.repository.listAgentFiles(work.id);
    const legacy = revision === 0 ? work.config : {};
    const parsedFiles = new Map<string, ReturnType<typeof parseSkill>>();
    const readParsed = (file: AgentFile) => {
      // get：读取值。
      let parsed = parsedFiles.get(file.id);
      if (!parsed) {
        // parseSkill：解析当前输入。
        // readText：读取当前数据。
        parsed = parseSkill(this.readText(file));
        // set：写入值。
        parsedFiles.set(file.id, parsed);
      }
      return parsed;
    };
    const configs: Record<string, AgentConfig> = {};
    const effective = [];
    for (const id of authorStepIds) {
      // resolveStep：处理当前步骤。
      const resolved = this.resolveStep(
        { document, legacy, revision, files, readParsed },
        id,
      );
      configs[id] = resolved.config;
      // push：追加元素。
      // effectiveStep：处理当前步骤。
      effective.push(this.effectiveStep(id, resolved));
    }
    // parse：解析输入。
    return {
      configs,
      view: authorConfigViewSchema.parse({
        workId: work.id,
        revision,
        document,
        files,
        effective,
      }),
    };
  }
  private work(workId: string): WorkDetail {
    // getWork：读取当前数据。
    const work = this.store.getWork(workId);
    if (!work) {
      throw new KnownError("work-not-found", "work not found");
    }
    return work;
  }
  get(workId: string) {
    // getAuthorConfig：读取当前数据。
    const saved = this.repository.getAuthorConfig(workId);
    // savedVersion：写入当前结果。
    const version = savedVersion(saved);
    // resolve：完成异步调用。
    // work：处理当前步骤。
    return this.resolve(this.work(workId), version.document, version.revision)
      .view;
  }
  save(workId: string, input: AuthorConfigSave) {
    // safeParse：校验并解析输入。
    const parsed = authorConfigSaveSchema.safeParse(input);
    if (!parsed.success) {
      // invalid：处理当前步骤。
      throw invalid();
    }
    const request = parsed.data;
    // getAuthorConfigReceipt：读取当前数据。
    const prior = this.repository.getAuthorConfigReceipt(
      workId,
      request.requestId,
    );
    if (prior) {
      // stringify：序列化数据。
      // stringify：序列化数据。
      if (
        prior.revision !== request.expectedRevision + 1 ||
        JSON.stringify(prior.document) !== JSON.stringify(request.document)
      ) {
        throw new KnownError(
          "version-conflict",
          "request identity already used",
        );
      }
      // onSaved：处理当前步骤。
      this.onSaved(workId);
      return prior;
    }
    // resolve：完成异步调用。
    // work：处理当前步骤。
    // parse：解析输入。
    this.resolve(
      this.work(workId),
      authorConfigDocumentSchema.parse(request.document),
      request.expectedRevision + 1,
    );
    // saveAuthorConfig：写入当前结果。
    const receipt = this.repository.saveAuthorConfig(workId, request);
    // onSaved：处理当前步骤。
    this.onSaved(workId);
    return receipt;
  }
  snapshot(work: WorkDetail): Record<string, AgentConfig> {
    // getAuthorConfig：读取当前数据。
    const saved = this.repository.getAuthorConfig(work.id);
    // savedVersion：写入当前结果。
    const version = savedVersion(saved);
    // resolve：完成异步调用。
    return this.resolve(work, version.document, version.revision).configs;
  }
}
