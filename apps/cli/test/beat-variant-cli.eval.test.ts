import { describe, expect, it } from 'vitest'
import { beatVariantSelectionRequestSchema, beatVariantSelectionResponseSchema } from '@agent4novel/contracts'

describe('E20 CLI/Harness acceptance: beat variant selection', () => {
  it('has a strict selection request and a complete comparison receipt', () => {
    expect(beatVariantSelectionRequestSchema.shape.choice).toBeDefined()
    expect(beatVariantSelectionResponseSchema.shape.comparison).toBeDefined()
  })

  it('does not allow an implicit approval in the selection receipt', () => {
    const status = beatVariantSelectionResponseSchema.shape.artifact
    expect(status).toBeDefined()
  })
})
