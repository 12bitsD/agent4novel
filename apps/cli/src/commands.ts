import type { ArtifactKind, CreativeContent, OutlineDraft, WorkView } from '@agent4novel/contracts'
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
  return client.approve(workId, kind)
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

// 一键全链路探针:create → advance → select(第一方向) → advance → approve outline → 终态快照
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
  await run('advance#1(caption+creative)', () => client.advance(work.id), (o) => JSON.stringify(o))
  await run('select(first direction)', () => select(client, work.id), (a) => `v${a.version} ${a.humanStatus}`)
  await run('advance#2(outline)', () => client.advance(work.id), (o) => JSON.stringify(o))
  await run('approve(outline)', () => client.approve(work.id, 'outline'), (o) => JSON.stringify(o))
  const final = await run('get(final)', () => client.getWork(work.id), (w) => w.workflowState)
  return { workId: work.id, steps, final }
}
