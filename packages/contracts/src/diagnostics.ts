import { z } from 'zod'
import { beatCommandObservationSchema } from './beat-command.js'
import { llmTelemetrySchema } from './telemetry.js'

export const diagnosticQuerySchema = z.object({
  requestId: z.string().uuid().optional(), attemptId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional(),
}).strict()
export const commandSummarySchema = z.object({
  command: beatCommandObservationSchema, code: z.string().min(1), recordedAt: z.string().datetime(),
}).strict()
const bufferWindow = z.object({
  capacity: z.literal(1000), oldestSeq: z.number().int().positive().nullable(), latestSeq: z.number().int().positive().nullable(), truncated: z.boolean(),
}).strict()
export const diagnosticResponseSchema = z.object({
  workId: z.string().min(1), telemetry: z.array(llmTelemetrySchema), commands: z.array(commandSummarySchema),
  window: z.object({
    processInstanceId: z.string().uuid(), retention: z.literal('process-memory'), llm: bufferWindow, commands: bufferWindow,
  }).strict(),
}).strict()
export type DiagnosticQuery = z.infer<typeof diagnosticQuerySchema>
export type DiagnosticResponse = z.infer<typeof diagnosticResponseSchema>
export type CommandSummary = z.infer<typeof commandSummarySchema>
