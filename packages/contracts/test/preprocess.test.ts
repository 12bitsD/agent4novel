import { describe, it, expect } from 'vitest'
import {
  preprocessContentSchema,
  interviewQuestionsSchema,
  interviewAnswerSchema,
} from '../src/index.js'

// 多实例并存形态（#3b 定案）：inputStage + 四类要点数组
const validContent = {
  inputStage: '脑洞',
  hooks: ['卖点一', '卖点二'],
  synopsis: ['梗概一'],
  setting: [{ title: '世界观', content: '现代都市下的异能暗面' }],
  outline: [{ title: '主线', content: '觉醒 → 暗战 → 揭秘' }],
}

describe('preprocessContentSchema', () => {
  it('accepts the multi-instance shape', () => {
    const parsed = preprocessContentSchema.parse(validContent)
    expect(parsed.inputStage).toBe('脑洞')
    expect(parsed.hooks).toHaveLength(2)
    expect(parsed.setting[0]?.title).toBe('世界观')
  })

  it('accepts empty arrays（要点可为空，由作者后续补）', () => {
    const parsed = preprocessContentSchema.parse({
      ...validContent,
      hooks: [],
      synopsis: [],
      setting: [],
      outline: [],
    })
    expect(parsed.hooks).toEqual([])
  })

  it('rejects the old four-string provisional shape', () => {
    expect(() =>
      preprocessContentSchema.parse({ hook: 'h', synopsis: 's', setting: 'st', outline: 'o' }),
    ).toThrow()
  })

  it('rejects an unknown inputStage', () => {
    expect(() => preprocessContentSchema.parse({ ...validContent, inputStage: '灵感' })).toThrow()
  })

  it('rejects non-array hooks', () => {
    expect(() => preprocessContentSchema.parse({ ...validContent, hooks: 'x' })).toThrow()
  })

  it('rejects a setting item without content', () => {
    expect(() =>
      preprocessContentSchema.parse({ ...validContent, setting: [{ title: 'x' }] }),
    ).toThrow()
  })
})

describe('interviewQuestionsSchema', () => {
  it('accepts a questions list', () => {
    expect(interviewQuestionsSchema.parse({ questions: ['q1', 'q2'] }).questions).toHaveLength(2)
  })

  it('rejects non-string questions', () => {
    expect(() => interviewQuestionsSchema.parse({ questions: [1] })).toThrow()
  })
})

describe('interviewAnswerSchema', () => {
  it('accepts a question/answer pair', () => {
    expect(interviewAnswerSchema.parse({ question: 'q', answer: 'a' }).answer).toBe('a')
  })

  it('rejects a missing answer', () => {
    expect(() => interviewAnswerSchema.parse({ question: 'q' })).toThrow()
  })
})
