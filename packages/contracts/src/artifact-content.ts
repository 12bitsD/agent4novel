import { z } from 'zod'
import type { ArtifactKind, HumanStatus } from './artifact-envelope.js'
import { captionContentSchema } from './caption.js'
import { creativeContentSchema } from './creative.js'
import { outlineContentSchema } from './outline.js'
import { settingContentSchema } from './setting.js'
import { beatContentSchema } from './beat.js'
import { proseContentSchema, proseEditDraftSchema } from './prose.js'

// Persisted content always has server identities. Only pending prose permits incomplete edits.
export const artifactContentSchemas = {
  caption: captionContentSchema,
  creative: creativeContentSchema,
  outline: outlineContentSchema,
  setting: settingContentSchema,
  beat: beatContentSchema,
  prose: proseContentSchema,
} satisfies Record<ArtifactKind, z.ZodTypeAny>
export type ArtifactContentByKind = { [K in ArtifactKind]: z.infer<(typeof artifactContentSchemas)[K]> }

export function artifactContentSchemaFor(kind: ArtifactKind, humanStatus: HumanStatus): z.ZodType<ArtifactContentByKind[ArtifactKind]> {
  return kind === 'prose' && humanStatus === 'pending' ? proseEditDraftSchema : artifactContentSchemas[kind]
}

export function parseArtifactContent(kind: ArtifactKind, humanStatus: HumanStatus, content: unknown): ArtifactContentByKind[ArtifactKind] {
  return artifactContentSchemaFor(kind, humanStatus).parse(content)
}
