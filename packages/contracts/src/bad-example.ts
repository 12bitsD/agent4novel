import { z } from 'zod'

export const badExampleLimits = { text: 10_000, note: 2000, page: 50, requestBytes: 196_608 } as const
const integer = z.number().int().nonnegative().safe()
const source = {
  chapter: integer.positive(), sourceArtifactId: z.string().min(1).max(256), sourceVersion: integer.positive(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), start: integer, end: integer,
  text: z.string().min(1).max(badExampleLimits.text).refine(text => text.trim().length > 0
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)),
  note: z.string().max(badExampleLimits.note),
}
const validRange = (v: { start: number; end: number; text: string }) => v.end > v.start && v.end - v.start === v.text.length
export const badExampleRequestSchema = z.object({ requestId: z.string().uuid(), ...source, note: source.note.default('') }).strict().refine(validRange)
export const badExampleSchema = z.object({ id: z.string().uuid(), workId: z.string().min(1), ...source, createdAt: z.string().datetime() }).strict().refine(validRange)
export const badExampleQuerySchema = z.object({ chapter: integer.positive().optional(), after: integer.positive().optional() }).strict()
export const badExamplePageSchema = z.object({
  workId: z.string().min(1), chapter: integer.positive().optional(), after: integer.positive().optional(),
  items: z.array(badExampleSchema).max(badExampleLimits.page), nextCursor: integer.positive().optional(),
}).strict().refine(page => new Set(page.items.map(item => item.id)).size === page.items.length
  && page.items.every(item => item.workId === page.workId && (page.chapter === undefined || item.chapter === page.chapter))
  && (page.nextCursor === undefined || (page.items.length === badExampleLimits.page && page.nextCursor > (page.after ?? 0))))
export type BadExampleRequest = z.infer<typeof badExampleRequestSchema>
export type BadExample = z.infer<typeof badExampleSchema>
export type BadExampleQuery = z.infer<typeof badExampleQuerySchema>
export type BadExamplePage = z.infer<typeof badExamplePageSchema>
export function matchesBadExample(record: BadExample, workId: string, request: BadExampleRequest): boolean {
  return record.workId === workId && record.id === request.requestId
    && Object.keys(source).every(key => record[key as keyof typeof source] === request[key as keyof typeof source])
}
