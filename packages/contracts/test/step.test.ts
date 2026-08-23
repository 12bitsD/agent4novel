import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { runStep, emptyAgentConfig, type Step } from '../src/index.js'

const echoStep: Step<{ x: number }, { y: number }> = {
  id: 'echo',
  inputSchema: z.object({ x: z.number() }),
  outputSchema: z.object({ y: z.number() }),
  async run(input) {
    return { y: input.x * 2 }
  },
}

describe('runStep', () => {
  it('validates input and passes parsed input to run', async () => {
    await expect(runStep(echoStep, { x: 21 }, emptyAgentConfig)).resolves.toEqual({ y: 42 })
  })

  it('rejects invalid input', async () => {
    await expect(runStep(echoStep, { x: 'nope' }, emptyAgentConfig)).rejects.toThrow()
  })

  it('rejects invalid output', async () => {
    const badStep: Step<{ x: number }, { y: number }> = {
      ...echoStep,
      run: async () => ({ y: 'not-a-number' }) as unknown as { y: number },
    }
    await expect(runStep(badStep, { x: 1 }, emptyAgentConfig)).rejects.toThrow()
  })
})
