import { describe, it, expect } from 'vitest'
import { settingContentSchema } from '../src/index.js'

const validSetting = {
  worldview: '现代都市下的异能暗面',
  powerSystem: '九境修炼，灵根分级',
  factions: [{ name: '异能管理所', description: '监管异能者的官方机构' }],
  characters: [
    { name: '林澈', role: '主角', motivation: '守护妹妹', profile: '高二学生，觉醒读心能力' },
  ],
}

describe('settingContentSchema', () => {
  it('accepts the full shape', () => {
    const parsed = settingContentSchema.parse(validSetting)
    expect(parsed.characters[0]?.profile).toBe('高二学生，觉醒读心能力')
  })

  it('accepts the optional extra slot（JsonValue 扩展槽）', () => {
    const parsed = settingContentSchema.parse({
      ...validSetting,
      extra: { themes: ['校园', '悬疑'] },
    })
    expect(parsed.extra?.['themes']).toEqual(['校园', '悬疑'])
  })

  it('rejects a character without profile', () => {
    expect(() =>
      settingContentSchema.parse({
        ...validSetting,
        characters: [{ name: 'x', role: 'y', motivation: 'z' }],
      }),
    ).toThrow()
  })

  it('rejects a missing worldview', () => {
    expect(() =>
      settingContentSchema.parse({
        powerSystem: validSetting.powerSystem,
        factions: validSetting.factions,
        characters: validSetting.characters,
      }),
    ).toThrow()
  })

  it('rejects a non-JsonValue extra entry', () => {
    expect(() =>
      settingContentSchema.parse({ ...validSetting, extra: { bad: undefined } }),
    ).toThrow()
  })
})
