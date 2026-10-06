import { z } from 'zod'
import { artifactEnvelopeSchema } from './artifact-envelope.js'
import { outlineContentSchema } from './outline.js'

// Bind approval to the Outline the author actually read; never substitute a later head.
export const outlineApprovalRequestBytes = 4096
export const outlineApprovalRequestSchema = z.object({
  expectedArtifactId: z.string().min(1).max(200),
  expectedHeadVersion: z.number().int().positive().safe(),
}).strict()
export type OutlineApprovalRequest = z.infer<typeof outlineApprovalRequestSchema>

export const outlineApprovalResponseSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('outline'), chapter: z.undefined().optional(),
  content: outlineContentSchema, humanStatus: z.literal('approved'),
}).strict()
export type OutlineApprovalResponse = z.infer<typeof outlineApprovalResponseSchema>

// This confirms the requested target's state, not which earlier HTTP write won.
export function matchesOutlineApprovalResponse(workId: string, request: OutlineApprovalRequest, candidate: unknown): boolean {
  const expected = outlineApprovalRequestSchema.safeParse(request)
  const observed = outlineApprovalResponseSchema.safeParse(candidate)
  return expected.success && observed.success && observed.data.workId === workId
    && observed.data.id === expected.data.expectedArtifactId && observed.data.version === expected.data.expectedHeadVersion
}
