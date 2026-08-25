import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'
import { seed } from '../src/seed.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'

const jsonHeaders = { 'Content-Type': 'application/json' }

describe('works routes', () => {
  it('lists seeded works', async () => {
    const store = new InMemoryStore()
    seed(store)
    const res = await createApp(store).request('/api/works')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ title: string; chapterCount: number }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(3)
    expect(body[0]).toHaveProperty('title')
    expect(body[0]).toHaveProperty('chapterCount')
  })

  it('returns a work detail by id', async () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x', title: 't' })
    const res = await createApp(store).request(`/api/works/${w.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; artifacts: unknown[] }
    expect(body.id).toBe(w.id)
    expect(body.artifacts).toEqual([])
  })

  it('returns 404 for an unknown work', async () => {
    const store = new InMemoryStore()
    const res = await createApp(store).request('/api/works/nope')
    expect(res.status).toBe(404)
  })

  it('creates a work via POST', async () => {
    const store = new InMemoryStore()
    const res = await createApp(store).request('/api/works', {
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
    const store = new InMemoryStore()
    const res = await createApp(store).request('/api/works', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ seed: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('saves preprocess content, versions it, and marks approved', async () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    const app = createApp(store)
    const content = {
      inputStage: '脑洞',
      hooks: ['h'],
      synopsis: ['s'],
      setting: [{ title: 'st', content: 'c' }],
      outline: [{ title: 'o', content: 'c' }],
    }
    const res1 = await app.request(`/api/works/${w.id}/artifacts/preprocess`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content }),
    })
    expect(res1.status).toBe(200)
    const a1 = (await res1.json()) as { version: number; humanStatus: string }
    expect(a1.version).toBe(1)
    expect(a1.humanStatus).toBe('approved')

    const res2 = await app.request(`/api/works/${w.id}/artifacts/preprocess`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: { ...content, hooks: ['h2'] } }),
    })
    const a2 = (await res2.json()) as { version: number }
    expect(a2.version).toBe(2)
  })

  it('rejects invalid preprocess content', async () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    const res = await createApp(store).request(`/api/works/${w.id}/artifacts/preprocess`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: { hooks: 'not-an-array' } }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT on unknown work returns 404', async () => {
    const store = new InMemoryStore()
    const res = await createApp(store).request('/api/works/nope/artifacts/preprocess', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({
        content: {
          inputStage: '脑洞',
          hooks: ['h'],
          synopsis: ['s'],
          setting: [{ title: 'st', content: 'c' }],
          outline: [{ title: 'o', content: 'c' }],
        },
      }),
    })
    expect(res.status).toBe(404)
  })
})
