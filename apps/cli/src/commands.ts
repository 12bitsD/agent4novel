import type { ArtifactKind, CreativeContent, OutlineDraft, WorkView } from '@agent4novel/contracts'
import {
  matchesSettingSubmission, settingApproveRequestSchema, settingApproveResponseSchema, settingArtifactSchema,
  perChapterKinds,
  beatApproveRequestSchema, beatRegenerateRequestSchema, beatArtifactSchema, recoverBeatSubmission, beatCommandErrorSchema, beatCommandResponseSchema,
  matchesBeatSubmission,
} from '@agent4novel/contracts'
import { CliError } from './client.js'
import type { Client } from './client.js'
import type { BeatSubmission, DiagnosticQuery } from '@agent4novel/contracts'

// 命令层(#14):每个命令返回可 JSON 序列化的结果,由 main 打印;进度一律走 stderr(logger 注入)

export type Logger = (line: string) => void

export async function list(client: Client) {
  return client.listWorks()
}

export async function create(client: Client, args: { seed: string; title?: string }) {
  return client.createWork(args)
}

// --kind 时只取该产物(快照里每个 kind 只有 head 版本)
export async function get(client: Client, workId: string, kind?: ArtifactKind, chapter?: number) {
  if ((!kind && chapter !== undefined) || (kind && perChapterKinds.includes(kind) !== (chapter !== undefined))
    || (chapter !== undefined && (!Number.isSafeInteger(chapter) || chapter <= 0))) throw new CliError('Chapter artifacts require --chapter; work artifacts forbid it', 'usage')
  const work = await client.getWork(workId)
  if (!kind) return work
  const artifact = work.artifacts.find((a) => a.kind === kind && a.chapter === chapter)
  if (!artifact) throw new CliError(`no ${kind} artifact`, 'artifact-not-found', 404)
  return artifact
}

export async function advance(client: Client, workId: string) {
  return client.advance(workId)
}

function headOf(work: WorkView, kind: ArtifactKind): number {
  const head = work.artifacts.find((a) => a.kind === kind)?.version
  if (head === undefined) throw new CliError(`no ${kind} artifact`, 'artifact-not-found', 404)
  return head
}

// select/save 自动回填 expectedHeadVersion:一次快照同时供方向解析与乐观锁,Agent 不用自己记账
// directionId 缺省取第一个方向(smoke 场景);交互场景应显式传
export async function select(client: Client, workId: string, directionId?: string) {
  const work = await client.getWork(workId)
  let dir = directionId
  if (!dir) {
    const creative = work.artifacts.find((a) => a.kind === 'creative')
    const first = creative && (creative.content as CreativeContent).directions[0]
    if (!first) throw new CliError('no direction to select', 'direction-not-selected', 409)
    dir = first.directionId
  }
  return client.select(workId, dir, headOf(work, 'creative'))
}

export async function saveOutline(client: Client, workId: string, content: OutlineDraft) {
  const work = await client.getWork(workId)
  return client.saveOutline(workId, content, headOf(work, 'outline'))
}

export async function approve(client: Client, workId: string, kind: ArtifactKind) {
  if (kind === 'beat') throw new CliError('Use approve-beat with a complete request file', 'beat-approval-required')
  if (kind === 'setting') {
    throw new CliError('Use approve-setting <workId> --file <request.json> to submit edited content and expectedHeadVersion', 'setting-approval-required')
  }
  return client.approve(workId, kind)
}

export async function approveSetting(client: Client, workId: string, input: unknown) {
  const request = settingApproveRequestSchema.safeParse(input)
  if (!request.success) throw new CliError('Invalid setting approval request; expected content and expectedHeadVersion', 'invalid-input')
  const work = await client.getWork(workId)
  const baseline = settingArtifactSchema.safeParse(work.artifacts.find((artifact) => artifact.kind === 'setting'))
  if (!baseline.success) throw new CliError('No setting artifact', 'artifact-not-found', 404)
  if (baseline.data.humanStatus === 'approved') {
    throw new CliError('Setting is already approved; use get --kind setting to inspect it. This invocation cannot confirm an earlier submission', 'artifact-already-approved', 409)
  }
  if (baseline.data.version !== request.data.expectedHeadVersion) {
    throw new CliError('The request file version does not match the current setting; it was not replaced or submitted', 'version-conflict', 409)
  }
  let failure: unknown
  try {
    const candidate = await client.approveSetting(workId, request.data)
    if (!matchesSettingSubmission(baseline.data, request.data, candidate)) {
      throw new CliError('Setting response does not match this submission', 'invalid-response', 200)
    }
    return candidate
  } catch (error) {
    failure = error
  }
  const error = failure instanceof CliError ? failure : undefined
  const rejected = error?.status !== undefined
    && error.status >= 400 && error.status < 500 && error.code !== 'invalid-response'
  if (rejected && error?.status !== 409) throw failure

  // One read can confirm the desired result; it never proves a timed-out POST was cancelled.
  const latest = await client.getWork(workId).catch(() => undefined)
  const candidate = settingApproveResponseSchema.safeParse(latest?.artifacts.find((artifact) => artifact.kind === 'setting'))
  if (candidate.success) {
    if (matchesSettingSubmission(baseline.data, request.data, candidate.data)) return candidate.data
    throw new CliError('Setting was approved with different content; keep the request file and read the current setting', 'setting-conflict', 409)
  }
  if (rejected) throw failure
  throw new CliError('Setting approval result is unknown; keep the request file and inspect the current setting before continuing', 'setting-result-unknown')
}

// LLM 遥测回看(#14):advance 响应里已内联本次的;这个命令用于事后/跨次分析
export async function logs(client: Client, workId: string, query: DiagnosticQuery = {}) {
  return client.getTelemetry(workId, query)
}

export async function runBeatCommand(client: Client, workId: string, operation: BeatSubmission['operation'], input: unknown) {
  const parsed = (operation === 'approve-beat' ? beatApproveRequestSchema : beatRegenerateRequestSchema).safeParse(input)
  if (!parsed.success) throw new CliError('Invalid Beat request file', 'invalid-input', undefined, false, undefined,
    parsed.error.issues.map(({ path, code }) => ({ path, code, message: 'invalid field' })))
  const submission: BeatSubmission = operation === 'approve-beat'
    ? { operation, request: beatApproveRequestSchema.parse(parsed.data) } : { operation, request: beatRegenerateRequestSchema.parse(parsed.data) }
  const local = { operation, target: { workId, kind: 'beat', chapter: 1 }, expectedHead: { artifactId: submission.request.expectedArtifactId, version: submission.request.expectedHeadVersion } }
  const work = await client.getWork(workId)
  const baseline = beatArtifactSchema.safeParse(work.artifacts.find(a => a.kind === 'beat' && a.chapter === 1))
  if (!baseline.success) throw new CliError('No first-chapter Beat', 'artifact-not-found', 404, false, undefined, undefined, { ...local, resolution: 'rejected', nextActions: ['read-work'], observedHead: null })
  if (baseline.data.id !== submission.request.expectedArtifactId || baseline.data.version !== submission.request.expectedHeadVersion || baseline.data.humanStatus !== 'pending') {
    throw new CliError('Request baseline is no longer pending; the file was not modified or submitted', 'version-conflict', 409, false, undefined, undefined,
      { ...local, resolution: 'conflict', nextActions: ['read-work', 'load-server-version'], observedHead: { artifactId: baseline.data.id, version: baseline.data.version, humanStatus: baseline.data.humanStatus } })
  }
  let response: { status: number; body: unknown } | undefined
  let causeCode = 'network-error'
  try { response = await client.beatCommand(workId, submission) } catch (error) { if (error instanceof CliError) causeCode = error.code }
  let recovery = recoverBeatSubmission({ baseline: baseline.data, submission, hasUnknownWrite: false, response })
  if (recovery.resolution === 'confirmed') return beatCommandResponseSchema.parse(response!.body)
  const failure = beatCommandErrorSchema.safeParse(response?.body)
  if (failure.success) causeCode = failure.data.code
  else if (response) causeCode = 'invalid-response'
  let latest: WorkView | undefined
  try { latest = await client.getWork(workId, true) } catch (error) { if (error instanceof CliError && error.code === 'work-not-found') causeCode = 'work-not-found' }
  recovery = recoverBeatSubmission({ baseline: baseline.data, submission, hasUnknownWrite: recovery.hasUnknownWrite, response, work: latest, workIsReadback: latest !== undefined })
  if (recovery.resolution === 'confirmed') return { artifact: recovery.artifact, resolution: recovery.resolution, nextActions: recovery.nextActions, confirmedBy: 'read-work' }
  const code = recovery.resolution === 'conflict' ? 'beat-result-conflict' : recovery.resolution === 'uncertain' ? 'beat-result-unknown' : causeCode
  const { artifact: _artifact, ...safeRecovery } = recovery
  throw new CliError('Beat command did not confirm the requested result; keep the request file', code, response?.status,
    failure.success ? failure.data.retryable : false, failure.success ? failure.data.attemptId : undefined, failure.success ? failure.data.issues : undefined,
    { ...local, ...safeRecovery, causeCode, ...(failure.success ? { command: failure.data.command, telemetry: failure.data.telemetry, inputBudget: failure.data.inputBudget } : {}) })
}

export type SmokeResult = {
  workId: string
  executionMode: 'demo' | 'live'
  steps: { step: string; ok: boolean; detail: string }[]
  final: WorkView
}

// 一键全链路探针包含真实的页内编辑等价操作，最后必须确认设定定稿。
export async function smoke(
  client: Client,
  args: { seed: string; title?: string },
  log: Logger,
): Promise<SmokeResult> {
  const steps: SmokeResult['steps'] = []
  let executionMode: 'demo' | 'live' | 'unknown' = 'unknown'
  let smokeWorkId: string | undefined
  const run = async <T>(step: string, fn: () => Promise<T>, detail: (r: T) => string): Promise<T> => {
    log(`[smoke] ${step} ...`)
    let r: T
    try { r = await fn() } catch (error) {
      const cause = error instanceof CliError ? error : new CliError('Smoke operation failed', 'smoke-failed')
      steps.push({ step, ok: false, detail: cause.code })
      throw new CliError(cause.message, cause.code, cause.status, cause.retryable, cause.attemptId, cause.issues,
        { ...cause.details, workId: smokeWorkId, executionMode, steps })
    }
    steps.push({ step, ok: true, detail: detail(r) })
    log(`[smoke] ${step} ✓ ${detail(r)}`)
    return r
  }

  const mode = await run('config', () => client.getConfig(), config => config.demo ? 'demo' : 'live')
  executionMode = mode.demo ? 'demo' : 'live'
  const work = await run('create', () => client.createWork(args), (w) => w.id)
  smokeWorkId = work.id
  const advanceSmoke = async () => {
    const outcome = await client.advance(work.id)
    if (outcome.kind === 'failed') {
      throw new CliError(`Smoke stopped at ${outcome.stepId}`, outcome.code, 200, outcome.retryable, outcome.attemptId, undefined,
        { telemetry: outcome.telemetry, ...(outcome.beatCommand ? { command: outcome.beatCommand } : {}), ...(outcome.inputBudget ? { inputBudget: outcome.inputBudget } : {}) })
    }
    return outcome
  }
  await run('advance#1(caption+creative)', advanceSmoke, (o) => JSON.stringify(o))
  await run('select(first direction)', () => select(client, work.id), (a) => `v${a.version} ${a.humanStatus}`)
  await run('advance#2(outline)', advanceSmoke, (o) => JSON.stringify(o))
  await run('approve(outline)', () => client.approve(work.id, 'outline'), (o) => JSON.stringify(o))
  await run('advance#3(setting)', advanceSmoke, (o) => JSON.stringify(o))
  const pending = await run('get(setting)', async () => {
    const current = await client.getWork(work.id)
    const parsed = settingArtifactSchema.safeParse(current.artifacts.find((artifact) => artifact.kind === 'setting'))
    if (!parsed.success || parsed.data.humanStatus !== 'pending') {
      throw new CliError('Smoke requires a pending setting before review', 'smoke-incomplete')
    }
    return parsed.data
  }, (artifact) => `v${artifact.version} pending`)
  const request = {
    content: { ...pending.content, overview: `${pending.content.overview}\n\n作者确认：这是本次 smoke 的设定定稿。` },
    expectedHeadVersion: pending.version,
  }
  await run('approve-setting(edited)', () => approveSetting(client, work.id, request), (artifact) => `v${artifact.version} approved`)
  await run('advance#4(beat)', advanceSmoke, outcome => outcome.kind)
  const pendingBeat = await run('get(beat#1)', async () => {
    const artifact = beatArtifactSchema.parse(await get(client, work.id, 'beat', 1))
    if (artifact.humanStatus !== 'pending') throw new CliError('Smoke requires pending Beat review', 'smoke-incomplete')
    return artifact
  }, artifact => `v${artifact.version} pending`)
  const beatRequest = { chapter: 1 as const, expectedArtifactId: pendingBeat.id, expectedHeadVersion: pendingBeat.version,
    content: { ...pendingBeat.content, goal: `${pendingBeat.content.goal}\n\n作者确认：先保护证人，再追问线索。` },
  }
  await run('approve-beat(edited)', () => runBeatCommand(client, work.id, 'approve-beat', beatRequest), () => 'approved')
  const final = await run('get(final)', async () => {
    const current = await client.getWork(work.id)
    if (current.workflowState !== 'beat-approved' || !matchesBeatSubmission(pendingBeat, beatRequest, current.artifacts.find(a => a.kind === 'beat' && a.chapter === 1))
      || !matchesSettingSubmission(pending, request, current.artifacts.find(a => a.kind === 'setting'))
      || current.artifacts.some(a => a.kind === 'prose')) throw new CliError('Smoke did not reach the expected approved Beat without prose', 'smoke-incomplete')
    return current
  }, current => current.workflowState)
  return { workId: work.id, executionMode, steps, final }
}
