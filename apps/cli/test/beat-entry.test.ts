import { helpFor, parseCommandLine } from '../src/command-line.js'
import { describe, expect, it } from 'vitest'

describe('Beat command-line contract', () => {
  it('advertises dedicated commands and rejects a missing request file', () => {
    expect(() => parseCommandLine(['regenerate-beat', 'work-test'])).toThrow(
      expect.objectContaining({ code: 'usage' }),
    )
    const help = helpFor([])
    expect(help).toContain('regenerate-beat')
    expect(help).toContain('--chapter')
  })
})
