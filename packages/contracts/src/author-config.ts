import { z } from 'zod'
import { generationParametersSchema } from './step.js'

export const authorStepIds = ['caption', 'creative', 'outline', 'setting', 'beat', 'prose'] as const
export const authorConfigLimits = { fileBytes: 32_768, metadataBytes: 4096, filesPerWork: 64, skillsPerStep: 4, systemChars: 48_000 } as const
export const authorStepIdSchema = z.enum(authorStepIds)
export const authorPreferencesSchema = z.object({
  style: z.string().max(500).optional(), genre: z.string().max(500).optional(), payoff: z.string().max(500).optional(),
}).strict()
export const authorStepConfigSchema = z.object({
  ...generationParametersSchema.shape,
  model: z.string().regex(/^(deepseek:[a-zA-Z0-9_.-]{1,96}|longcat:LongCat-2\.0)$/).optional(),
  systemPromptRef: z.string().uuid().nullable().optional(),
  skills: z.array(z.string().uuid()).max(authorConfigLimits.skillsPerStep).refine(ids => new Set(ids).size === ids.length).optional(),
  tools: z.array(z.never()).max(0).optional(),
  directionCount: z.number().int().min(1).max(3).optional(),
}).strict()
export const authorConfigDocumentSchema = z.object({
  preferences: authorPreferencesSchema,
  defaults: authorStepConfigSchema,
  steps: z.object(Object.fromEntries(authorStepIds.map(id => [id, authorStepConfigSchema.optional()])) as Record<typeof authorStepIds[number], z.ZodOptional<typeof authorStepConfigSchema>>).strict(),
}).strict()
export const authorConfigSaveSchema = z.object({
  requestId: z.string().uuid(), expectedRevision: z.number().int().min(0).safe(), document: authorConfigDocumentSchema,
}).strict()
export const authorConfigReceiptSchema = z.object({
  workId: z.string().min(1), requestId: z.string().uuid(), revision: z.number().int().positive().safe(),
  document: authorConfigDocumentSchema,
}).strict()
export const agentFileSchema = z.object({
  id: z.string().uuid(), workId: z.string().min(1), kind: z.enum(['prompt', 'skill']),
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64), description: z.string().min(1).max(1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive().max(authorConfigLimits.fileBytes),
  createdAt: z.string().datetime(),
}).strict()
export const agentFileUploadSchema = z.object({
  requestId: z.string().uuid(), kind: z.enum(['prompt', 'skill']), text: z.string().min(1).max(authorConfigLimits.fileBytes),
}).strict()
export const agentFileReadSchema = z.object({ file: agentFileSchema, text: z.string().min(1).max(authorConfigLimits.fileBytes) }).strict()
export const effectiveAuthorStepSchema = z.object({
  id: authorStepIdSchema, model: authorStepConfigSchema.shape.model.unwrap(), provider: z.enum(['deepseek', 'longcat']), configured: z.boolean(),
  executionMode: z.enum(['demo', 'live']), generation: generationParametersSchema,
  appliedPreferences: authorPreferencesSchema, systemPrompt: agentFileSchema.nullable(), skills: z.array(agentFileSchema).max(authorConfigLimits.skillsPerStep),
  tools: z.array(z.never()).max(0), directionCount: z.number().int().min(1).max(3),
}).strict()
export const authorConfigViewSchema = z.object({
  workId: z.string().min(1), revision: z.number().int().min(0).safe(), document: authorConfigDocumentSchema,
  files: z.array(agentFileSchema).max(authorConfigLimits.filesPerWork), effective: z.array(effectiveAuthorStepSchema).length(6),
}).strict().superRefine((view, ctx) => {
  const matchesLibrary = (file: z.infer<typeof agentFileSchema>, kind: 'prompt' | 'skill') => file.kind === kind
    && view.files.some(stored => stored.id === file.id && JSON.stringify(stored) === JSON.stringify(file))
  if (new Set(view.effective.map(s => s.id)).size !== 6 || view.files.some(f => f.workId !== view.workId)
    || new Set(view.files.map(f => f.id)).size !== view.files.length
    || view.effective.some(s => s.provider !== (s.model.startsWith('longcat:') ? 'longcat' : 'deepseek')
      || (s.systemPrompt && !matchesLibrary(s.systemPrompt, 'prompt')) || s.skills.some(f => !matchesLibrary(f, 'skill'))
      || new Set(s.skills.map(f => f.id)).size !== s.skills.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effective'], message: 'configuration identity mismatch' })
  }
})
export type AuthorConfigDocument = z.infer<typeof authorConfigDocumentSchema>
export type AuthorConfigSave = z.infer<typeof authorConfigSaveSchema>
export type AuthorConfigReceipt = z.infer<typeof authorConfigReceiptSchema>
export type AuthorConfigView = z.infer<typeof authorConfigViewSchema>
export type AuthorStepId = typeof authorStepIds[number]
export type AgentFile = z.infer<typeof agentFileSchema>
export type AgentFileUpload = z.infer<typeof agentFileUploadSchema>
export const emptyAuthorConfig = (): AuthorConfigDocument => ({ preferences: {}, defaults: {}, steps: {} })
export function managedAgentFileText(kind: AgentFileUpload['kind'], text: string): string {
  return kind === 'prompt' ? `---\nname: author-prompt\ndescription: Author writing guidance\n---\n${text}` : text
}
