import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'
import { seed } from '../src/seed.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'

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
})
