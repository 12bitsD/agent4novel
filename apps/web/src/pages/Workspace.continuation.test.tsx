// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import Workspace from './Workspace.js'

const base = { workId: 'chapter-work', version: 1, createdAt: '2026-09-29' }
const beat = (chapter: number, approved = true) => ({ ...base, id: `beat-${chapter}`, kind: 'beat', chapter, humanStatus: approved ? 'approved' : 'pending',
  content: { title: `章节标题 ${chapter}`, goal: `目标 ${chapter}`, writingPlan: [{ itemId: `plan-${chapter}`, title: '行动', content: '行动内容' }], ending: `落点 ${chapter}` } })
const prose = (chapter: number, approved = true) => ({ ...base, id: `prose-${chapter}`, kind: 'prose', chapter, humanStatus: approved ? 'approved' : 'pending', content: { text: `正文内容 ${chapter}` } })
const summary = (chapter: number, status: 'approved' | 'pending' | 'beat' = 'approved') => ({ chapter, title: `章节标题 ${chapter}`, beatStatus: status === 'beat' ? 'pending' : 'approved', proseStatus: status === 'beat' ? null : status,
  allowedActions: status === 'approved' ? ['save-draft', 'start-next-chapter'] : status === 'beat' ? ['approve', 'regenerate'] : ['save-draft', 'approve', 'regenerate'], needsContinuityReview: false })
const makeWork = (second: 'approved' | 'pending' | 'beat' = 'pending') => ({ id: base.workId, title: '按章创作', seed: '原始脑洞', config: {}, createdAt: base.createdAt,
  artifacts: [beat(1), prose(1), beat(2, second !== 'beat'), ...(second === 'beat' ? [] : [prose(2, second === 'approved')])], currentChapter: 2,
  chapters: [{ ...summary(1), allowedActions: ['save-draft'] }, summary(2, second)], workflowState: second === 'beat' ? 'awaiting-beat-review' : second === 'approved' ? 'prose-approved' : 'awaiting-prose-review',
  nextStepId: null, allowedActions: summary(2, second).allowedActions })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!
const chapterButton = (host: HTMLElement, chapter: number) => host.querySelector<HTMLButtonElement>(`[data-chapter="${chapter}"]`)!
async function edit(host: HTMLElement, value: string) {
  const input = host.querySelector('#prose-text') as HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function saveResponse(old: ReturnType<typeof prose>, saved: ReturnType<typeof prose>) {
  return { artifact: saved, workflow: { workflowState: 'awaiting-beat-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] }, telemetry: [],
    command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'save-prose', target: { workId: base.workId, kind: 'prose', chapter: old.chapter },
      expectedHead: { artifactId: old.id, version: old.version, humanStatus: old.humanStatus }, resultHead: { artifactId: saved.id, version: saved.version, humanStatus: saved.humanStatus },
      executionMode: 'demo', latencyMs: 1, attemptIds: [], writeOutcome: 'committed' } }
}
async function mount(fetchMock: (url: string, init?: RequestInit) => Promise<Response>, initialChapter?: number) {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(<Workspace workId={base.workId} initialChapter={initialChapter} onBack={() => {}} />))
  return { host, root, dispose: async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() } }
}

describe('按章续写与阅读', () => {
  it('opens the current chapter by default and browses an older chapter without generating', async () => {
    const calls = vi.fn(async () => json(makeWork()))
    const ui = await mount(calls)
    try {
      expect(ui.host.textContent).toContain('正文内容 2')
      expect(ui.host.textContent).not.toContain('正文内容 1')
      expect(chapterButton(ui.host, 2).getAttribute('aria-current')).toBe('page')
      await act(async () => chapterButton(ui.host, 1).click())
      expect(ui.host.textContent).toContain('正文内容 1')
      expect(ui.host.textContent).not.toContain('正文内容 2')
      expect(button(ui.host, '通过正文')).toBeUndefined()
      expect(button(ui.host, '编辑章纲')).toBeUndefined()
      expect(calls.mock.calls).toHaveLength(2)
    } finally { await ui.dispose() }
  })

  it('autosaves approved history even while the next chapter is at its Beat gate', async () => {
    let work = makeWork('beat')
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prose/save')) {
        const request = JSON.parse(init!.body as string)
        expect(request).toMatchObject({ chapter: 1, expectedArtifactId: 'prose-1', expectedHeadVersion: 1, expectedHumanStatus: 'approved', content: { text: '旧章修改后的正文' } })
        const saved = { ...prose(1), id: 'prose-1-v2', version: 2, content: request.content }
        work = { ...work, artifacts: [beat(1), saved, beat(2, false)], chapters: [work.chapters[0]!, { ...work.chapters[1]!, needsContinuityReview: true }] }
        return json(saveResponse(prose(1), saved))
      }
      return json(work)
    })
    const ui = await mount(calls, 1)
    try {
      expect(ui.host.textContent).toContain('正文内容 1')
      await act(async () => button(ui.host, '编辑正文').click())
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).disabled).toBe(false)
      await edit(ui.host, '旧章修改后的正文')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(ui.host.textContent).toContain('已保存')
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/prose/save'))).toHaveLength(1)
      await act(async () => chapterButton(ui.host, 2).click())
      expect(ui.host.textContent).toContain('前章正文已修改，请检查本章衔接')
      expect(ui.host.textContent).toContain('目标 2')
    } finally { await ui.dispose() }
  })

  it('posts the selected chapter address for later prose autosave', async () => {
    let work = makeWork()
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prose/save')) {
        const request = JSON.parse(init!.body as string)
        expect(request.chapter).toBe(2)
        const saved = { ...prose(2, false), id: 'prose-2-v2', version: 2, content: request.content }
        work = { ...work, artifacts: [beat(1), prose(1), beat(2), saved] }
        return json(saveResponse(prose(2, false), saved))
      }
      return json(work)
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await edit(ui.host, '第二章的修改')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/prose/save'))).toHaveLength(1)
      expect(ui.host.textContent).toContain('已保存')
    } finally { await ui.dispose() }
  })

  it('starts a next chapter only on an explicit click with the saved previous version', async () => {
    let started = false
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/chapters/start')) {
        expect(JSON.parse(init!.body as string)).toEqual({ chapter: 2, expectedPreviousProseId: 'prose-1', expectedPreviousProseVersion: 1 })
        started = true
        return json({ kind: 'advanced', stepId: 'beat', state: { workId: base.workId, stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'beat', chapter: 2 } }, telemetry: [] })
      }
      return json(started ? makeWork('beat') : { ...makeWork('approved'), currentChapter: 1, artifacts: [beat(1), prose(1)], chapters: [summary(1)] })
    })
    const ui = await mount(calls)
    try {
      expect(calls).toHaveBeenCalledTimes(1)
      expect(ui.host.textContent).toContain('第一章已完成')
      await act(async () => button(ui.host, '开始下一章').click())
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/chapters/start'))).toHaveLength(1)
      expect(ui.host.textContent).toContain('目标 2')
      expect(button(ui.host, '通过章纲并生成正文')).toBeDefined()
      expect(calls.mock.calls.some(([url]) => url.endsWith('/advance'))).toBe(false)
    } finally { await ui.dispose() }
  })

  it('protects unsaved edits during chapter switching and discards only after confirmation', async () => {
    const calls = vi.fn(async () => json(makeWork()))
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await edit(ui.host, '尚未保存的第二章')
      await act(async () => chapterButton(ui.host, 1).click())
      expect(ui.host.querySelector('[role="dialog"]')).not.toBeNull()
      await act(async () => button(ui.host, '继续编辑').click())
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).value).toBe('尚未保存的第二章')
      await act(async () => chapterButton(ui.host, 1).click())
      await act(async () => button(ui.host, '放弃修改并切换').click())
      expect(ui.host.textContent).toContain('正文内容 1')
      expect(ui.host.querySelector('#prose-text')).toBeNull()
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(calls.mock.calls).toHaveLength(2)
    } finally { await ui.dispose() }
  })

  it('prevents chapter switching during an in-flight save and an unresolved save', async () => {
    let writes = 0
    let finish!: () => void
    const calls = vi.fn(async (url: string) => {
      if (url.endsWith('/prose/save')) { writes++; await new Promise<void>(resolve => { finish = resolve }); throw new Error('lost reply') }
      if (writes) throw new Error('readback unavailable')
      return json(makeWork())
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await edit(ui.host, '保存结果尚未确认')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(chapterButton(ui.host, 1).disabled).toBe(true)
      await act(async () => finish())
      expect(ui.host.textContent).toContain('提交结果尚未确认')
      expect(chapterButton(ui.host, 1).disabled).toBe(true)
      expect(writes).toBe(1)
    } finally { await ui.dispose() }
  })
  it('recovers a lost next-chapter response with one read and no repeated generation', async () => {
    let started = false
    const calls = vi.fn(async (url: string) => {
      if (url.endsWith('/chapters/start')) { started = true; throw new Error('lost reply') }
      return json(started ? makeWork('beat') : { ...makeWork('approved'), currentChapter: 1, artifacts: [beat(1), prose(1)], chapters: [summary(1)] })
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '开始下一章').click())
      expect(ui.host.textContent).toContain('目标 2')
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/chapters/start'))).toHaveLength(1)
      expect(calls.mock.calls.filter(([url]) => !url.endsWith('/chapters/start'))).toHaveLength(3) // initial, reconciliation, isolated chapter session
    } finally { await ui.dispose() }
  })

  it('keeps an unknown start request frozen across retry and prevents edits meanwhile', async () => {
    const requests: unknown[] = []
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/chapters/start')) { requests.push(JSON.parse(init!.body as string)); throw new Error('lost reply') }
      return json({ ...makeWork('approved'), currentChapter: 1, artifacts: [beat(1), prose(1)], chapters: [summary(1)] })
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '开始下一章').click())
      expect(ui.host.textContent).toContain('结果尚未确认')
      await act(async () => button(ui.host, '编辑正文').click())
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).disabled).toBe(true)
      await act(async () => button(ui.host, '重试开始下一章').click())
      expect(requests).toHaveLength(2)
      expect(requests[1]).toEqual(requests[0])
    } finally { await ui.dispose() }
  })

  it('treats a definite start rejection as rejected, leaving the saved chapter editable', async () => {
    const calls = vi.fn(async (url: string) => url.endsWith('/chapters/start')
      ? json({ code: 'version-conflict', message: 'previous version changed', retryable: false }, 409)
      : json({ ...makeWork('approved'), currentChapter: 1, artifacts: [beat(1), prose(1)], chapters: [summary(1)] }))
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '开始下一章').click())
      expect(ui.host.textContent).toContain('version-conflict')
      expect(ui.host.textContent).not.toContain('结果尚未确认')
      await act(async () => button(ui.host, '编辑正文').click())
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).disabled).toBe(false)
    } finally { await ui.dispose() }
  })

  it('keeps late chapter reads from replacing a reopened chapter session', async () => {
    let reads = 0
    let finish!: (response: Response) => void
    const calls = vi.fn(async () => {
      if (++reads === 2) return new Promise<Response>(resolve => { finish = resolve })
      return json(makeWork())
    })
    const ui = await mount(calls)
    try {
      await act(async () => chapterButton(ui.host, 1).click())
      await act(async () => ui.root.render(<Workspace key="reopened" workId={base.workId} initialChapter={2} onBack={() => {}} />))
      await act(async () => finish(json(makeWork())))
      expect(ui.host.textContent).toContain('正文内容 2')
      expect(ui.host.textContent).not.toContain('正文内容 1')
      expect(chapterButton(ui.host, 2).getAttribute('aria-current')).toBe('page')
    } finally { await ui.dispose() }
  })

  it('approves the second Beat and starts its prose once through the combined button', async () => {
    let stage = 'beat'
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/beat/approve')) {
        expect(JSON.parse(init!.body as string)).toMatchObject({ chapter: 2, expectedArtifactId: 'beat-2' })
        stage = 'ready'
        return json({ artifact: beat(2), workflow: { workflowState: 'ready-to-generate', nextStepId: 'prose', allowedActions: ['generate'] }, telemetry: [],
          command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'approve-beat', target: { workId: base.workId, kind: 'beat', chapter: 2 },
            expectedHead: { artifactId: 'beat-2', version: 1 }, resultHead: { artifactId: 'beat-2', version: 1, humanStatus: 'approved' }, executionMode: 'demo', latencyMs: 1, attemptIds: [], writeOutcome: 'committed' } })
      }
      if (url.endsWith('/advance')) {
        stage = 'prose'
        return json({ kind: 'advanced', stepId: 'prose', state: { workId: base.workId, stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'prose', chapter: 2 } }, telemetry: [] })
      }
      return json(stage === 'prose' ? makeWork() : stage === 'beat' ? makeWork('beat') : { ...makeWork('beat'),
        artifacts: [beat(1), prose(1), beat(2)], workflowState: 'ready-to-generate', nextStepId: 'prose', allowedActions: ['generate'],
        chapters: [{ ...summary(1), allowedActions: ['save-draft'] }, { ...summary(2, 'beat'), beatStatus: 'approved', allowedActions: ['generate'] }] })
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '通过章纲并生成正文').click())
      expect(ui.host.textContent).toContain('正文内容 2')
      expect(ui.host.textContent).not.toContain('正文内容 1')
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
    } finally { await ui.dispose() }
  })

  it('makes approved setting and Beat available as read-only reference material', async () => {
    const setting = { ...base, id: 'setting', kind: 'setting', humanStatus: 'approved',
      content: { overview: '作品规则总览', world: [{ itemId: 'world-1', title: '世界规则', content: '不可违背的规则' }],
        characters: [{ itemId: 'person-1', title: '人物档案', content: '人物动机' }], factions: [], relationships: [], extensions: [] } }
    const calls = vi.fn(async () => json({ ...makeWork(), artifacts: [...makeWork().artifacts, setting] }))
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '设定').click())
      const reference = ui.host.querySelector('[aria-label="创作资料"]')!
      expect(reference.textContent).toContain('作品规则总览')
      expect(reference.querySelectorAll('input, textarea')).toHaveLength(0)
      expect(button(ui.host, '编辑设定')).toBeUndefined()
      await act(async () => button(ui.host, '本章已通过章纲').click())
      expect(reference.textContent).toContain('目标 2')
      expect(reference.querySelectorAll('input, textarea')).toHaveLength(0)
      expect(button(ui.host, '编辑章纲')).toBeUndefined()
      expect(calls).toHaveBeenCalledTimes(1)
    } finally { await ui.dispose() }
  })

  it('does not let a late Beat approval automatically generate a different current chapter', async () => {
    let approved = false
    const calls = vi.fn(async (url: string) => {
      if (url.endsWith('/beat/approve')) {
        approved = true
        return json({ artifact: beat(2), workflow: { workflowState: 'ready-to-generate', nextStepId: 'prose', allowedActions: ['generate'] }, telemetry: [],
          command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'approve-beat', target: { workId: base.workId, kind: 'beat', chapter: 2 },
            expectedHead: { artifactId: 'beat-2', version: 1 }, resultHead: { artifactId: 'beat-2', version: 1, humanStatus: 'approved' }, executionMode: 'demo', latencyMs: 1, attemptIds: [], writeOutcome: 'committed' } })
      }
      if (url.endsWith('/advance')) return json({ kind: 'advanced', stepId: 'prose', state: { workId: base.workId, stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'prose', chapter: 3 } }, telemetry: [] })
      return json(!approved ? makeWork('beat') : { ...makeWork('approved'), currentChapter: 3,
        artifacts: [...makeWork('approved').artifacts, beat(3)], workflowState: 'ready-to-generate', nextStepId: 'prose', allowedActions: ['generate'],
        chapters: [{ ...summary(1), allowedActions: ['save-draft'] }, { ...summary(2), allowedActions: ['save-draft'] },
          { ...summary(3, 'beat'), beatStatus: 'approved', allowedActions: ['generate'] }] })
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '通过章纲并生成正文').click())
      expect(ui.host.textContent).toContain('正文内容 2')
      expect(calls.mock.calls.some(([url]) => url.endsWith('/advance'))).toBe(false)
    } finally { await ui.dispose() }
  })

})

it('keeps HTTP200 unknown start frozen if readback fails', async () => {
  let writes = 0
  const requests: unknown[] = []
  let recovered = false
  const calls = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/chapters/start')) {
      writes++
      requests.push(JSON.parse(init!.body as string))
      if (writes === 2) return json({ kind: 'failed', stepId: 'beat', code: 'llm-unavailable', retryable: true,
        state: { workId: base.workId, stage: 'complete', nextStepId: null }, telemetry: [] })
      return json({kind:'failed',stepId:'beat',code:'internal-error',retryable:true,state:{workId:base.workId,stage:'awaiting-approval',nextStepId:null,pendingGate:{kind:'beat',chapter:3}},telemetry:[],
        beatCommand:{kind:'execution-result',requestId:'11111111-1111-4111-8111-111111111111',operation:'generate-beat',target:{workId:base.workId,kind:'beat',chapter:3},expectedHead:null,writeOutcome:'unknown',failureStage:'commit',attemptIds:[],executionMode:'demo',latencyMs:1}})
    }
    if (recovered) return json({ ...makeWork('approved'), currentChapter: 3, artifacts: [...makeWork('approved').artifacts, beat(3, false)],
      chapters: [...makeWork('approved').chapters, summary(3, 'beat')], workflowState: 'awaiting-beat-review' })
    if (writes) throw new Error('readback unavailable')
    return json(makeWork('approved'))
  })
  const ui=await mount(calls)
  try {
    await act(async () => button(ui.host,'开始下一章').click())
    expect(chapterButton(ui.host,1).disabled).toBe(true)
    await act(async () => button(ui.host,'编辑正文').click())
    expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).disabled).toBe(true)
    await act(async () => button(ui.host,'重试开始下一章').click())
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(chapterButton(ui.host,1).disabled).toBe(true)
    expect(button(ui.host,'重试开始下一章')).toBeDefined()
    recovered = true
    await act(async () => button(ui.host,'刷新作品').click())
    expect(ui.host.textContent).toContain('目标 3')
    expect(chapterButton(ui.host,1).disabled).toBe(false)
  } finally { await ui.dispose() }
})

it.each(['transport', 'http200-unknown'] as const)('protects unknown initial prose generation and recovers only its original target: %s', async (failure) => {
  const ready={...makeWork('beat'),artifacts:[beat(1),prose(1),beat(2)],workflowState:'ready-to-generate',nextStepId:'prose',allowedActions:['generate'],chapters:[{...summary(1),allowedActions:['save-draft']},{...summary(2,'beat'),beatStatus:'approved',allowedActions:['generate']}]}
  let recovered = false
  const calls = vi.fn(async (url: string) => {
    if (url.endsWith('/advance')) {
      if (failure === 'transport') throw new Error('lost reply')
      return json({ kind: 'failed', stepId: 'prose', code: 'internal-error', retryable: true, state: { workId: base.workId, stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'prose', chapter: 2 } }, telemetry: [],
        proseCommand: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'generate-prose', target: { workId: base.workId, kind: 'prose', chapter: 2 }, expectedHead: null, writeOutcome: 'unknown', failureStage: 'commit', attemptIds: [], executionMode: 'demo', latencyMs: 1 } })
    }
    return json(recovered ? makeWork() : ready)
  })
  const ui=await mount(calls)
  try {
    await act(async()=>button(ui.host,'生成第 2 章正文').click())
    expect(ui.host.textContent).toContain('生成结果尚未确认')
    expect(chapterButton(ui.host,1).disabled).toBe(true)
    expect(button(ui.host,'生成第 2 章正文').disabled).toBe(true)
    await act(async () => button(ui.host,'刷新作品').click())
    expect(chapterButton(ui.host,1).disabled).toBe(true)
    expect(calls.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
    recovered = true
    await act(async () => button(ui.host,'刷新作品').click())
    expect(ui.host.textContent).toContain('正文内容 2')
    expect(chapterButton(ui.host,1).disabled).toBe(false)
    expect(calls.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
  } finally {await ui.dispose()}
})
