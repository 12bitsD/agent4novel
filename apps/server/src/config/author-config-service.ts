import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { isAlias, parseDocument, visit } from 'yaml'
import {
  agentFileSchema, agentFileUploadSchema, authorConfigDocumentSchema, authorConfigLimits, authorConfigSaveSchema,
  authorConfigViewSchema, authorStepIds, emptyAuthorConfig,
  managedAgentFileText,
  type AgentConfig, type AgentFile, type AgentFileUpload, type AuthorConfigDocument, type AuthorConfigSave, type WorkDetail,
} from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import { modelRuntime, type ModelRuntime } from '../steps/llm.js'
import { systemFor } from '../steps/llm-call.js'
import type { WorkStore } from '../store/work-store.js'
import type { AuthorConfigRepository } from './author-config-repository.js'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const invalid = () => new KnownError('config-invalid', 'invalid author configuration or file')
const unavailable = () => new KnownError('agent-file-unavailable', 'selected agent file is unavailable or changed')

function parseSkill(text: string): { name: string; description: string; body: string } {
  if (Buffer.byteLength(text) > authorConfigLimits.fileBytes || new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(text)) !== text) throw invalid()
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text)
  if (!match || Buffer.byteLength(match[1]!) > authorConfigLimits.metadataBytes || !match[2]!.trim()) throw invalid()
  try {
    const yaml = parseDocument(match[1]!, { strict: true, uniqueKeys: true, stringKeys: true })
    if (yaml.errors.length) throw invalid()
    visit(yaml, (_key, node) => { if (isAlias(node)) throw invalid() })
    const meta = yaml.toJS({ maxAliasCount: 0 }) as Record<string, unknown>
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw invalid()
    const checked = agentFileSchema.pick({ name: true, description: true }).safeParse({ name: meta.name, description: meta.description })
    if (!checked.success || !checked.data.description.trim()) throw invalid()
    if (meta.license !== undefined && typeof meta.license !== 'string') throw invalid()
    if (meta.compatibility !== undefined && (typeof meta.compatibility !== 'string' || meta.compatibility.length > 500)) throw invalid()
    if (meta['allowed-tools'] !== undefined && typeof meta['allowed-tools'] !== 'string') throw invalid()
    if (meta.metadata !== undefined && (!meta.metadata || typeof meta.metadata !== 'object' || Array.isArray(meta.metadata)
      || Object.values(meta.metadata).some(value => typeof value !== 'string'))) throw invalid()
    return { ...checked.data, body: match[2]! }
  } catch { throw invalid() }
}

export class AuthorConfigService {
  private readonly root: string
  constructor(private readonly store: WorkStore, private readonly repository: AuthorConfigRepository, dataDir: string, private readonly runtime: ModelRuntime = modelRuntime) {
    this.root = resolve(dataDir, 'prompts')
  }
  private path(file: AgentFile): string { return join(this.root, hash(file.workId), file.id, file.name, 'SKILL.md') }
  private ensureDirectory(path: string): void {
    const rel = relative(this.root, path)
    if (rel.startsWith('..') || rel.startsWith(sep)) throw unavailable()
    let current = this.root
    for (const part of ['', ...rel.split(sep)]) {
      if (part) current = join(current, part)
      try { mkdirSync(current, { mode: 0o700 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const stat = lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw unavailable()
    }
  }
  private assertContained(path: string): void {
    const rel = relative(this.root, path)
    if (rel.startsWith(`..${sep}`) || rel === '..' || rel === '' || rel.startsWith(sep)) throw unavailable()
    let current = this.root
    // Every managed component is private and must not be a symlink.
    if (lstatSync(current).isSymbolicLink()) throw unavailable()
    for (const part of rel.split(sep)) {
      current = join(current, part)
      if (lstatSync(current).isSymbolicLink()) throw unavailable()
    }
    if (relative(realpathSync(this.root), realpathSync(path)).startsWith('..')) throw unavailable()
  }
  private readText(file: AgentFile): string {
    let fd: number | undefined
    try {
      const path = this.path(file); this.assertContained(path)
      fd = openSync(path, 'r')
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size !== file.byteLength || stat.size > authorConfigLimits.fileBytes) throw unavailable()
      const buffer = Buffer.alloc(authorConfigLimits.fileBytes + 1)
      let length = 0
      while (length < buffer.length) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (!n) break; length += n }
      if (length !== file.byteLength) throw unavailable()
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))
      if (hash(text) !== file.sha256) throw unavailable()
      return text
    } catch { throw unavailable() }
    finally { if (fd !== undefined) closeSync(fd) }
  }
  readFile(workId: string, id: string) {
    const file = this.repository.listAgentFiles(workId).find(f => f.id === id)
    if (!file) throw unavailable()
    return { file, text: this.readText(file) }
  }
  upload(workId: string, input: AgentFileUpload): AgentFile {
    const parsed = agentFileUploadSchema.safeParse(input)
    if (!parsed.success) throw invalid()
    const request = parsed.data
    const text = managedAgentFileText(request.kind, request.text)
    const meta = parseSkill(text)
    const file = agentFileSchema.parse({ id: request.requestId, workId, kind: request.kind, name: meta.name, description: meta.description,
      sha256: hash(text), byteLength: Buffer.byteLength(text), createdAt: new Date().toISOString() })
    const files = this.repository.listAgentFiles(workId)
    const old = files.find(f => f.id === file.id)
    if (old) {
      if (old.sha256 !== file.sha256 || old.kind !== file.kind) throw new KnownError('version-conflict', 'file request identity already used')
      this.readText(old)
      return old
    }
    if (files.length >= authorConfigLimits.filesPerWork) throw invalid()
    const path = this.path(file), temporary = `${path}.${randomUUID()}.tmp`
    let created = false
    try {
      this.ensureDirectory(dirname(path))
      this.assertContained(dirname(path))
      try {
        const existing = lstatSync(path)
        if (!existing.isFile() || existing.isSymbolicLink()) throw unavailable()
        this.readText(file) // Unselected orphan from an earlier failed DB write is reusable only if identical.
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const fd = openSync(temporary, 'wx', 0o600); created = true
        try { writeFileSync(fd, text, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
        // Atomic exclusive publication: concurrent uploads can never replace a version file.
        try { linkSync(temporary, path) }
        catch (publicationError) {
          if ((publicationError as NodeJS.ErrnoException).code !== 'EEXIST') throw publicationError
          this.readText(file)
        }
        unlinkSync(temporary); created = false
        const directory = openSync(dirname(path), 'r')
        try { fsyncSync(directory) } finally { closeSync(directory) }
      }
      return this.repository.putAgentFile(file)
    } catch (error) {
      if (error instanceof KnownError) throw error
      throw unavailable()
    } finally { if (created) { try { unlinkSync(temporary) } catch { /* failed private temp remains unselected */ } } }
  }
  private resolve(work: WorkDetail, document: AuthorConfigDocument, revision: number) {
    const files = this.repository.listAgentFiles(work.id)
    const legacy = revision === 0 ? work.config : {}
    const configs: Record<string, AgentConfig> = {}
    const effective = authorStepIds.map(id => {
      const selected = { ...document.defaults, ...document.steps[id] }
      const model = selected.model ?? legacy.model ?? this.runtime.defaultModelId
      const config: AgentConfig = { ...legacy, ...selected, model }
      delete (config as Record<string, unknown>).systemPromptRef
      config.skills = []
      config.tools = []
      const find = (fileId: string, kind: AgentFile['kind']) => {
        const file = files.find(f => f.id === fileId && f.kind === kind)
        if (!file) throw invalid()
        return file
      }
      const prompt = selected.systemPromptRef ? find(selected.systemPromptRef, 'prompt') : null
      const skills = (selected.skills ?? []).map(fileId => find(fileId, 'skill'))
      const appliedPreferences = Object.fromEntries(Object.entries(document.preferences).filter(([key, value]) => value && (
        key === 'style' ? id === 'prose' : key === 'genre' ? id !== 'caption' : ['creative', 'outline', 'beat', 'prose'].includes(id)
      )))
      const guidance = [
        ...(Object.keys(appliedPreferences).length ? [`Author preferences: ${JSON.stringify(appliedPreferences)}`] : []),
        ...(prompt ? [parseSkill(this.readText(prompt)).body] : selected.systemPromptRef === null ? [] : legacy.systemPrompt ? [legacy.systemPrompt] : []),
        ...skills.map(file => `Skill ${file.name}:\n${parseSkill(this.readText(file)).body}`),
      ].join('\n\n')
      if (guidance.length > authorConfigLimits.systemChars) throw invalid()
      config.systemPrompt = guidance
      config.configRevision = revision
      systemFor(id, config)
      config.configFiles = [...(prompt ? [prompt] : []), ...skills].map(file => ({ id: file.id, sha256: file.sha256 }))
      let generation
      try {
        generation = this.runtime.generationSettings(config).parameters
        if (this.runtime.mode === 'live') this.runtime.languageModel(model)
      } catch { throw invalid() }
      configs[id] = config
      return { id, model, provider: model.startsWith('longcat:') ? 'longcat' as const : model.startsWith('kimi:') ? 'kimi' as const : 'deepseek' as const,
        configured: this.runtime.mode === 'live', executionMode: this.runtime.mode, generation, appliedPreferences,
        systemPrompt: prompt, skills, tools: [], directionCount: config.directionCount ?? 2 }
    })
    return { configs, view: authorConfigViewSchema.parse({ workId: work.id, revision, document, files, effective }) }
  }
  private work(workId: string): WorkDetail {
    const work = this.store.getWork(workId)
    if (!work) throw new KnownError('work-not-found', 'work not found')
    return work
  }
  get(workId: string) {
    const saved = this.repository.getAuthorConfig(workId)
    return this.resolve(this.work(workId), saved?.document ?? emptyAuthorConfig(), saved?.revision ?? 0).view
  }
  save(workId: string, input: AuthorConfigSave) {
    const parsed = authorConfigSaveSchema.safeParse(input)
    if (!parsed.success) throw invalid()
    const request = parsed.data
    const prior = this.repository.getAuthorConfigReceipt(workId, request.requestId)
    if (prior) {
      if (prior.revision !== request.expectedRevision + 1 || JSON.stringify(prior.document) !== JSON.stringify(request.document)) {
        throw new KnownError('version-conflict', 'request identity already used')
      }
      return prior
    }
    this.resolve(this.work(workId), authorConfigDocumentSchema.parse(request.document), request.expectedRevision + 1)
    return this.repository.saveAuthorConfig(workId, request)
  }
  snapshot(work: WorkDetail): Record<string, AgentConfig> {
    const saved = this.repository.getAuthorConfig(work.id)
    return this.resolve(work, saved?.document ?? emptyAuthorConfig(), saved?.revision ?? 0).configs
  }
}
