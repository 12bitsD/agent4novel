import { describe, it, expect, vi } from 'vitest'
import { parseFile, type FileLike } from '../src/file-parser.js'

vi.mock('../src/docx.js', () => ({ extractDocxText: vi.fn(async () => 'docx text') }))
vi.mock('../src/pdf.js', () => ({ extractPdfText: vi.fn(async () => 'pdf text') }))

const file = (name: string, text: string): FileLike => ({
  name,
  text: async () => text,
  arrayBuffer: async () => new ArrayBuffer(0),
})

describe('parseFile', () => {
  it('reads txt directly', async () => {
    const result = await parseFile(file('idea.txt', 'hello'))
    expect(result).toEqual({ ok: true, text: 'hello' })
  })

  it('reads md directly', async () => {
    const result = await parseFile(file('notes.md', '# title'))
    expect(result).toEqual({ ok: true, text: '# title' })
  })

  it('routes docx to the docx adapter', async () => {
    const result = await parseFile(file('a.docx', 'ignored'))
    expect(result).toEqual({ ok: true, text: 'docx text' })
  })

  it('routes pdf to the pdf adapter', async () => {
    const result = await parseFile(file('a.pdf', 'ignored'))
    expect(result).toEqual({ ok: true, text: 'pdf text' })
  })

  it('normalizes failure into { ok: false }', async () => {
    const broken: FileLike = {
      name: 'a.docx',
      text: async () => 'x',
      arrayBuffer: async () => {
        throw new Error('boom')
      },
    }
    const result = await parseFile(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('boom')
  })
})
