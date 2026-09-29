import type { CreativeContent, OutlineContent } from '@agent4novel/contracts'

export const creativeContent = (directionId = 'w1-dir-1'): CreativeContent => ({ directions: [{
  directionId, title: '旅人回乡', hook: '回到失去名字的故乡', synopsis: '旅人寻找名字。',
  tags: ['奇幻'], characters: [], setting: [], payoffs: [], outline: [],
}] })
export const outlineContent = (): OutlineContent => ({ arcs: [1, 2, 3].map(i => ({
  arcId: `arc-${i}`, title: '寻访', conflict: '无人相认', development: '拜访旧友', resolution: '得到线索',
  segments: [1, 2].map(j => ({ segmentId: `arc-${i}-seg-${j}`, title: '街角问路', summary: '询问旧友', outcome: '得知渡口去向' })),
})) })
