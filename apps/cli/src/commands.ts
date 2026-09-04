import type { ArtifactKind, CreativeContent, OutlineDraft, WorkView } from '@agent4novel/contracts'
import {
  matchesSettingSubmission, settingApproveRequestSchema, settingApproveResponseSchema, settingArtifactSchema,
} from '@agent4novel/contracts'
import { CliError } from './client.js'
import type { Client } from './client.js'

// 命令层(#14):每个命令返回可 JSON 序列化的结果,由 main 打印;进度一律走 stderr(logger 注入)

export type Logger = (line: string) => void

export async function list(client: Client) {
  return client.listWorks()
}

export async function create(client: Client, args: { seed: string; title?: string }) {
  return client.createWork(args)
}

// --kind 时只取该产物(快照里每个 kind 只有 head 版本)
export async function get(client: Client, workId: string, kind?: ArtifactKind) {
  const work = await client.getWork(workId)
  if (!kind) return work
  const artifact = work.artifacts.find((a) => a.kind === kind)
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
export async function logs(client: Client, workId: string) {
  return client.getTelemetry(workId)
}

export type SmokeResult = {
  workId: string
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
  const run = async <T>(step: string, fn: () => Promise<T>, detail: (r: T) => string): Promise<T> => {
    log(`[smoke] ${step} ...`)
    const r = await fn()
    steps.push({ step, ok: true, detail: detail(r) })
    log(`[smoke] ${step} ✓ ${detail(r)}`)
    return r
  }

  const work = await run('create', () => client.createWork(args), (w) => w.id)
  const advanceSmoke = async () => {
    const outcome = await client.advance(work.id)
    if (outcome.kind === 'failed') {
      throw new CliError(`Smoke stopped at ${outcome.stepId}`, outcome.code, 200, outcome.retryable, outcome.attemptId)
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
  const final = await run('get(final)', () => client.getWork(work.id), (w) => w.workflowState)
  const candidate = final.artifacts.find((artifact) => artifact.kind === 'setting')
  if (final.workflowState !== 'setting-approved' || !matchesSettingSubmission(pending, request, candidate)) {
    throw new CliError('Smoke did not reach the expected approved setting', 'smoke-incomplete')
  }
  return { workId: work.id, steps, final }
}
