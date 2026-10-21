import { helpFor, parseCommandLine } from '../src/command-line.js'
import { describe, expect, it } from 'vitest'

describe('Prose command-line contract', () => {
  it('discovers complete prose request shapes and rejects unknown flags', () => {
    for (const command of ['approve-prose', 'regenerate-prose', 'save-prose']) {
      const help = helpFor([command, 'work-test', '--file', '/missing/request.json', '--help'])
      expect(help).toContain(`用法: a4n ${command}`)
      expect(help).toContain('expectedArtifactId')
      expect(help).toContain('text')
      if (command === 'save-prose') expect(help).toContain('expectedHumanStatus')
      expect(() => parseCommandLine([command, 'work-test', '--unknown', 'value'])).toThrow(
        expect.objectContaining({ code: 'usage' }),
      )
    }
  })
})
