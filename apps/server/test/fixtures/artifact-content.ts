import type { ArtifactContentByKind } from '@agent4novel/contracts'

export const caption = (note: string): ArtifactContentByKind['caption'] => ({ inputStage: '脑洞', summary: note, elements: [{ kind: '人物', content: note }], gaps: [] })
export const creative = (note: string): ArtifactContentByKind['creative'] => ({ directions: [{ directionId: 'direction-1', title: note, hook: note, tags: [], synopsis: note, characters: [], setting: [], payoffs: [], outline: [] }] })
export const outline = (note: string): ArtifactContentByKind['outline'] => ({ arcs: [1, 2, 3].map(i => ({ arcId: `arc-${i}`, title: note, conflict: note, development: note, resolution: note, segments: [1, 2].map(j => ({ segmentId: `segment-${i}-${j}`, title: note, summary: note, outcome: note })) })) })
export const setting = (note: string): ArtifactContentByKind['setting'] => ({ overview: note, world: [{ itemId: 'world-1', title: '世界', content: note }], characters: [{ itemId: 'character-1', title: '人物', content: note }], factions: [], relationships: [], extensions: [] })
export const beat = (note: string): ArtifactContentByKind['beat'] => ({ title: note, goal: note, writingPlan: [{ itemId: 'plan-1', title: '安排', content: note }], ending: note })
