import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonValueSchema } from '@agent4novel/contracts'
import { createApp } from '../src/app.js'
import { seed } from '../src/seed.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import type { ArtifactStep, PipelineDefinitionEntry } from '../src/pipeline/pipeline.js'
import { fakePreprocessStep, preprocessStepInputSchema } from './fakes.js'

const jsonHeaders = { 'Content-Type': 'application/json' }

const validPreprocess = {
  inputStage: '脑洞',
  hooks: ['h'],
  synopsis: ['s'],
  setting: [{ title: 'st', content: 'c' }],
  outline: [{ title: 'o', content: 'c' }],
}

// 与生产装配同形：store + pipeline（fake step）+ meta（demo/interview 开关）
function makeApp(opts?: { demo?: boolean; interview?: boolean; step?: ArtifactStep }) {
  const store = new InMemoryStore()
  const steps = new Map<string, ArtifactStep>([
    ['preprocess', opts?.step ?? fakePreprocessStep().step],
  ])
  const definition: PipelineDefinitionEntry[] = [
    {
      stepId: 'preprocess',
      outputKind: 'preprocess',
      gateAfter: { kind: 'preprocess' },
      interview: opts?.interview ?? true,
    },
  ]
  const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}) })
  const app = createApp({
    store,
    pipeline,
    meta: { demo: opts?.demo ?? true, interview: opts?.interview ?? true },
  })
  return { store, app }
}

describe('works routes', () => {
  it('lists seeded works', async () => {
    const { store, app } = makeApp()
    seed(store)
    const res = await app.request('/api/works')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ title: string; chapterCount: number }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(3)
    expect(body[0]).toHaveProperty('title')
    expect(body[0]).toHaveProperty('chapterCount')
  })

  it('returns a work detail by id', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x', title: 't' })
    const res = await app.request(`/api/works/${w.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; artifacts: unknown[] }
    expect(body.id).toBe(w.id)
    expect(body.artifacts).toEqual([])
  })

  it('returns 404 for an unknown work', async () => {
    const { app } = makeApp()
    const res = await app.request('/api/works/nope')
    expect(res.status).toBe(404)
  })

  it('creates a work via POST', async () => {
    const { app } = makeApp()
    const res = await app.request('/api/works', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ seed: '一个脑洞' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; seed: string; title: string }
    expect(body.seed).toBe('一个脑洞')
    expect(body.title).toBe('一个脑洞')
  })

  it('rejects POST with empty seed', async () => {
    const { app } = makeApp()
    const res = await app.request('/api/works', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ seed: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('saves preprocess content, versions it, and marks approved', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    const res1 = await app.request(`/api/works/${w.id}/artifacts/preprocess`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: validPreprocess }),
    })
    expect(res1.status).toBe(200)
    const a1 = (await res1.json()) as { version: number; humanStatus: string }
    expect(a1.version).toBe(1)
    expect(a1.humanStatus).toBe('approved')

    const res2 = await app.request(`/api/works/${w.id}/artifacts/preprocess`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: { ...validPreprocess, hooks: ['h2'] } }),
    })
    const a2 = (await res2.json()) as { version: number }
    expect(a2.version).toBe(2)
  })

  it('rejects invalid preprocess content', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    const res = await app.request(`/api/works/${w.id}/artifacts/preprocess`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: { hooks: 'not-an-array' } }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT on unknown work returns 404', async () => {
    const { app } = makeApp()
    const res = await app.request('/api/works/nope/artifacts/preprocess', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: validPreprocess }),
    })
    expect(res.status).toBe(404)
  })
})

describe('pipeline routes', () => {
  it('GET /api/config returns demo and interview flags', async () => {
    const { app } = makeApp({ demo: true, interview: true })
    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ demo: true, interview: true })
  })

  it('advance starts an interview: awaiting-interview with questions, no artifact', async () => {
    const { store, app } = makeApp({ interview: true })
    const w = store.createWork({ seed: '一个脑洞' })
    const res = await app.request(`/api/works/${w.id}/advance`, { method: 'POST' })
    expect(res.status).toBe(200)
    const state = (await res.json()) as {
      stage: string
      pendingInterview?: { questions: string[] }
    }
    expect(state.stage).toBe('awaiting-interview')
    expect(state.pendingInterview!.questions.length).toBeGreaterThan(0)
    expect(store.getWork(w.id)!.artifacts).toHaveLength(0)
  })

  it('advance is a no-op while awaiting interview', async () => {
    const { store, app } = makeApp({ interview: true })
    const w = store.createWork({ seed: 'x' })
    await app.request(`/api/works/${w.id}/advance`, { method: 'POST' })
    const res = await app.request(`/api/works/${w.id}/advance`, { method: 'POST' })
    const state = (await res.json()) as { stage: string }
    expect(state.stage).toBe('awaiting-interview')
    expect(store.getWork(w.id)!.artifacts).toHaveLength(0)
  })

  it('answer-interview normalizes and persists a pending artifact', async () => {
    const { store, app } = makeApp({ interview: true })
    const w = store.createWork({ seed: 'x' })
    await app.request(`/api/works/${w.id}/advance`, { method: 'POST' })
    const res = await app.request(`/api/works/${w.id}/answer-interview`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ answers: [{ question: '主角是谁？', answer: '林澈' }] }),
    })
    expect(res.status).toBe(200)
    const state = (await res.json()) as { stage: string }
    expect(state.stage).toBe('awaiting-approval')
    const artifacts = store.getWork(w.id)!.artifacts
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.humanStatus).toBe('pending')
  })

  it('answer-interview without a pending interview returns 400', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    const res = await app.request(`/api/works/${w.id}/answer-interview`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ answers: [] }),
    })
    expect(res.status).toBe(400)
  })

  it('answer-interview with an invalid body returns 400', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    const res = await app.request(`/api/works/${w.id}/answer-interview`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ answers: 'nope' }),
    })
    expect(res.status).toBe(400)
  })

  it('interview=false: advance normalizes directly', async () => {
    const { store, app } = makeApp({ interview: false })
    const w = store.createWork({ seed: 'x' })
    const res = await app.request(`/api/works/${w.id}/advance`, { method: 'POST' })
    const state = (await res.json()) as { stage: string }
    expect(state.stage).toBe('awaiting-approval')
    expect(store.getWork(w.id)!.artifacts).toHaveLength(1)
  })

  it('approve marks the artifact approved and completes the pipeline', async () => {
    const { store, app } = makeApp({ interview: false })
    const w = store.createWork({ seed: 'x' })
    await app.request(`/api/works/${w.id}/advance`, { method: 'POST' })
    const res = await app.request(`/api/works/${w.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'preprocess' }),
    })
    expect(res.status).toBe(200)
    const state = (await res.json()) as { stage: string }
    expect(state.stage).toBe('complete')
    expect(store.getWork(w.id)!.artifacts[0]!.humanStatus).toBe('approved')
  })

  it('approve with a chapter on a per-work kind returns 400', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    const res = await app.request(`/api/works/${w.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'preprocess', chapter: 1 }),
    })
    expect(res.status).toBe(400)
  })

  it('approve without a produced artifact returns 400', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    const res = await app.request(`/api/works/${w.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'preprocess' }),
    })
    expect(res.status).toBe(400)
  })

  it('advance on an unknown work returns 404', async () => {
    const { app } = makeApp()
    const res = await app.request('/api/works/nope/advance', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('returns 500 when the step fails（agent 输出不稳的兜底）', async () => {
    const badStep: ArtifactStep = {
      id: 'preprocess',
      inputSchema: preprocessStepInputSchema,
      outputSchema: z.object({ content: jsonValueSchema }),
      run: async () => {
        throw new Error('llm output schema mismatch')
      },
    }
    const { store, app } = makeApp({ step: badStep })
    const w = store.createWork({ seed: 'x' })
    const res = await app.request(`/api/works/${w.id}/advance`, { method: 'POST' })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('llm output schema mismatch')
  })
})
