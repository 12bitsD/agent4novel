import { z } from 'zod'
import { beatArtifactSchema, beatContentSchema } from './beat.js'

export const beatVariantComparisonSchema = z.object({
  original: beatArtifactSchema,
  candidate: beatArtifactSchema,
}).strict()
export type BeatVariantComparison = z.infer<typeof beatVariantComparisonSchema>

export const beatVariantSelectionRequestSchema = z.object({
  chapter: z.number().int().positive().safe(),
  expectedArtifactId: z.string().min(1).max(128),
  expectedHeadVersion: z.number().int().positive().safe(),
  originalArtifactId: z.string().min(1).max(128),
  originalVersion: z.number().int().positive().safe(),
  originalContent: beatContentSchema,
  choice: z.enum(['new', 'original']),
}).strict()
export type BeatVariantSelectionRequest = z.infer<typeof beatVariantSelectionRequestSchema>

const head = z.object({ artifactId: z.string().min(1), version: z.number().int().positive().safe() }).strict()
const resultHead = head.extend({ humanStatus: z.enum(['pending', 'approved']) })
export const beatVariantSelectionReceiptSchema = z.object({
  operation: z.literal('select-beat-variant'),
  workId: z.string().min(1),
  chapter: z.number().int().positive().safe(),
  expectedHead: head,
  originalHead: head,
  choice: z.enum(['new', 'original']),
  writeOutcome: z.enum(['committed', 'not-committed']),
  resultHead,
}).strict()
export type BeatVariantSelectionReceipt = z.infer<typeof beatVariantSelectionReceiptSchema>

const beatVariantSelectionResponseObjectSchema = z.object({
  artifact: beatArtifactSchema,
  comparison: beatVariantComparisonSchema,
  choice: z.enum(['new', 'original']),
  selection: beatVariantSelectionReceiptSchema,
}).strict()
// The response is intentionally structural: the endpoint and client enforce
// identity relationships, while readback records may carry the original
// artifact as the top-level artifact.
export const beatVariantSelectionResponseSchema = beatVariantSelectionResponseObjectSchema
export type BeatVariantSelectionResponse = z.infer<typeof beatVariantSelectionResponseSchema>
