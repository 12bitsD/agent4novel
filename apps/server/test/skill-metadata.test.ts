import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import { loadSkill } from '../src/steps/llm-call.js'

describe('production Skill metadata', () => {
  it.each([
    ['caption', '提炼作者素材，产出故事开发重心与具体剧情提案。', '你是故事开发编辑。'],
    ['prose', '依据章纲、设定与前章正文，生成或重写当前章正文。', '# 当前章正文\n\n你是中文网文作者。'],
  ])('loads valid Agent Skills frontmatter for %s without removing its body', (stepId, description, bodyStart) => {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(loadSkill(stepId))
    expect(match).not.toBeNull()
    if (!match) return
    const document = parseDocument(match[1], { strict: true, uniqueKeys: true, stringKeys: true })
    expect(document.errors).toEqual([])
    expect(document.toJS()).toEqual({ name: stepId, description })
    expect(match[2]?.startsWith(bodyStart)).toBe(true)
  })
})
