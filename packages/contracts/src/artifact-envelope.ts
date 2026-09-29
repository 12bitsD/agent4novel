import { z } from 'zod'

export const artifactKinds = ['caption', 'creative', 'outline', 'setting', 'beat', 'prose'] as const
export type ArtifactKind = (typeof artifactKinds)[number]

export const humanStatuses = ['pending', 'approved'] as const
export type HumanStatus = (typeof humanStatuses)[number]

export const perChapterKinds: ArtifactKind[] = ['beat', 'prose']
export const perWorkKinds: ArtifactKind[] = ['caption', 'creative', 'outline', 'setting']

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)]),
)

export const artifactInputSchema = z.object({
  kind: z.enum(artifactKinds), chapter: z.number().int().positive().safe().optional(),
  artifactId: z.string().min(1), version: z.number().int().positive().safe(),
}).strict().superRefine((input, ctx) => {
  if (perChapterKinds.includes(input.kind) !== (input.chapter !== undefined)) ctx.addIssue({ code: 'custom', path: ['chapter'], message: 'input chapter 与 kind 不匹配' })
})
export type ArtifactInput = z.infer<typeof artifactInputSchema>

export const artifactEnvelopeSchema = z.object({
  id: z.string().min(1),
  workId: z.string().min(1),
  kind: z.enum(artifactKinds),
  chapter: z.number().int().positive().safe().optional(),
  version: z.number().int().positive().safe(),
  content: jsonValueSchema,
  humanStatus: z.enum(humanStatuses),
  createdAt: z.string().min(1),
  inputs: z.array(artifactInputSchema).optional(),
}).strict()
