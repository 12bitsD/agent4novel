import { expect, it } from 'vitest'
import { matchesSettingSubmission, type SettingArtifact } from '../src/index.js'

const baseline: SettingArtifact = {
  id: 'a1', workId: 'w1', kind: 'setting', version: 1, humanStatus: 'pending', createdAt: '2026-09-05',
  content: {
    overview: '海港故事', world: [{ itemId: 'old-world', title: '海港', content: '港口开放。' }],
    characters: [{ itemId: 'old-person', title: '阿澄', content: '想要远航。' }],
    factions: [], relationships: [], extensions: [],
  },
}

it('按冻结请求确认最终内容，包括新卡的服务端身份', () => {
  const submitted = { expectedHeadVersion: 1, content: {
    ...baseline.content, overview: '作者修订的故事', factions: [{ title: '  船会 ', content: '**互助**组织。' }],
  } }
  const candidate = { ...baseline, humanStatus: 'approved', content: {
    ...submitted.content, factions: [{ itemId: 'new-faction', title: '船会', content: '**互助**组织。' }],
  } }
  expect(matchesSettingSubmission(baseline, submitted, candidate)).toBe(true)
  expect(matchesSettingSubmission(baseline, submitted, { ...candidate, workId: 'other' })).toBe(false)
  expect(matchesSettingSubmission(baseline, submitted, { ...candidate, humanStatus: 'pending' })).toBe(false)
  expect(matchesSettingSubmission(baseline, submitted, { ...candidate, content: { ...candidate.content, overview: '另一页修改' } })).toBe(false)
})

it('删除旧卡再新建同文卡，不能把别的页面保留旧身份误认作成功', () => {
  const submitted = { expectedHeadVersion: 1, content: {
    ...baseline.content, world: [{ title: '海港', content: '港口开放。' }],
  } }
  expect(matchesSettingSubmission(baseline, submitted, { ...baseline, humanStatus: 'approved' })).toBe(false)
  const candidate = { ...baseline, humanStatus: 'approved', content: {
    ...baseline.content, world: [{ itemId: 'new-world', title: '海港', content: '港口开放。' }],
  } }
  expect(matchesSettingSubmission(baseline, submitted, candidate)).toBe(true)
})

it('回读保留跨栏身份和精确正文，不接受重排、错误版本或非法内容', () => {
  const submitted = { expectedHeadVersion: 1, content: {
    ...baseline.content,
    characters: [{ title: '船长', content: '等待潮汐。' }],
    relationships: baseline.content.characters,
  } }
  const candidate = { ...baseline, humanStatus: 'approved', content: {
    ...submitted.content, characters: [{ itemId: 'new-person', title: '船长', content: '等待潮汐。' }],
  } }
  expect(matchesSettingSubmission(baseline, submitted, candidate)).toBe(true)
  expect(matchesSettingSubmission(baseline, { ...submitted, expectedHeadVersion: 2 }, candidate)).toBe(false)
  expect(matchesSettingSubmission(baseline, submitted, { ...candidate, id: 'other' })).toBe(false)
  expect(matchesSettingSubmission(baseline, submitted, { ...candidate, version: 2 })).toBe(false)
  expect(matchesSettingSubmission(baseline, submitted, { ...candidate, content: { ...candidate.content, overview: '海港故事\n' } })).toBe(false)
  expect(matchesSettingSubmission(baseline, submitted, { ...candidate, content: { ...candidate.content, world: [] } })).toBe(false)
})

it('不能把请求中的外来或跨类型 ID 当作已有身份确认', () => {
  const content = { ...baseline.content, world: [{ itemId: 'foreign', title: '海港', content: '港口开放。' }] }
  expect(matchesSettingSubmission(baseline, { expectedHeadVersion: 1, content }, { ...baseline, humanStatus: 'approved', content })).toBe(false)
})
