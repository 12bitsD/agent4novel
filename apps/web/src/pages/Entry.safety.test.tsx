// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import Entry from './Entry.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
async function mountEntry(fetchMock: (url: string, init?: RequestInit) => Promise<Response> = async () => json({ demo: true })) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const back = vi.fn(), created = vi.fn()
  await act(async () => root.render(<Entry onBack={back} onCreated={created} />))
  return { host, back, created, async dispose() { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() } }
}
async function editMaterial(host: HTMLElement, value: string) {
  const field = host.querySelector('textarea')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
  await act(async () => field.dispatchEvent(new Event('input', { bubbles: true })))
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!

it('protects material that has not yet been submitted and preserves it when leaving is cancelled', async () => {
  const ui = await mountEntry()
  try {
    await editMaterial(ui.host, '寄往明天的信。')
    await act(async () => button(ui.host, '← 返回书架').click())
    expect(ui.back).not.toHaveBeenCalled()
    expect(ui.host.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => button(ui.host, '继续编辑').click())
    expect(ui.host.querySelector('textarea')!.value).toBe('寄往明天的信。')
    expect(ui.back).not.toHaveBeenCalled()
    expect(ui.created).not.toHaveBeenCalled()
  } finally { await ui.dispose() }
})

it('waits for selected material to finish reading before allowing a work to be created', async () => {
  const ui = await mountEntry()
  let finish!: (text: string) => void
  const reading = new Promise<string>(resolve => { finish = resolve })
  try {
    await editMaterial(ui.host, '原有素材')
    const input = ui.host.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'slow.txt', type: 'text/plain', text: () => reading, arrayBuffer: async () => new ArrayBuffer(0) }] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(button(ui.host, '开始创作').disabled).toBe(true)
    expect(ui.host.textContent).toContain('正在读取素材')
    await act(async () => finish('文件中的素材'))
    expect(ui.host.querySelector('textarea')!.value).toBe('原有素材\n\n文件中的素材')
    expect(button(ui.host, '开始创作').disabled).toBe(false)
    expect(ui.created).not.toHaveBeenCalled()
  } finally { await ui.dispose() }
})


it('locks a creation synchronously so two activations submit once and never start generation', async () => {
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const calls: Array<{ url: string; method?: string }> = []
  const ui = await mountEntry(async (url, init) => {
    calls.push({ url, method: init?.method })
    if (url === '/api/config') return json({ demo: true })
    await pending
    return json({ id: 'created-once', title: '真实标题', seed: '作者素材', config: {}, createdAt: 'created' })
  })
  try {
    await editMaterial(ui.host, '作者素材')
    const submit = button(ui.host, '开始创作')
    await act(async () => { submit.click(); submit.click() })
    expect(calls.filter(call => call.method === 'POST')).toEqual([{ url: '/api/works', method: 'POST' }])
    await act(async () => finish())
    expect(ui.created).toHaveBeenCalledExactlyOnceWith('created-once')
    expect(calls.some(call => call.url.includes('/advance'))).toBe(false)
  } finally { await act(async () => finish()); await ui.dispose() }
})


it('keeps an unknown creation distinct from a new intent, preserving input until explicit confirmation', async () => {
  const submitted: unknown[] = []
  const ui = await mountEntry(async (url, init) => {
    if (url === '/api/config') return json({ demo: true })
    const input = JSON.parse(String(init?.body))
    submitted.push(input)
    if (submitted.length === 1) throw new Error('PRIVATE_PROVIDER_SENTINEL')
    return json({ id: 'new-intent-work', title: input.title, seed: input.seed, config: {}, createdAt: 'created' })
  })
  try {
    await editMaterial(ui.host, '寄往明天的信。')
    const title = ui.host.querySelector<HTMLInputElement>('input:not([type="file"])')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, '保留标题')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button(ui.host, '开始创作').click())
    expect(ui.host.textContent).toContain('创建结果尚未确认')
    expect(ui.host.textContent).not.toContain('PRIVATE_PROVIDER_SENTINEL')
    expect(ui.host.querySelector('textarea')!.value).toBe('寄往明天的信。')
    expect(title.value).toBe('保留标题')
    expect(button(ui.host, '开始创作').disabled).toBe(true)
    expect(ui.created).not.toHaveBeenCalled()
    await act(async () => button(ui.host, '开始一次新的创建').click())
    expect(ui.host.querySelector('[role="dialog"]')!.textContent).toContain('重复作品')
    await act(async () => button(ui.host, '保留当前输入').click())
    expect(submitted).toHaveLength(1)
    await act(async () => button(ui.host, '开始一次新的创建').click())
    await act(async () => button(ui.host, '仍然新建作品').click())
    expect(submitted).toEqual([{ seed: '寄往明天的信。', title: '保留标题' }, { seed: '寄往明天的信。', title: '保留标题' }])
    expect(ui.created).toHaveBeenCalledExactlyOnceWith('new-intent-work')
  } finally { await ui.dispose() }
})


it('can stop only local waiting, and an old creation reply cannot navigate after a new confirmed intent', async () => {
  let oldReply!: (response: Response) => void, newReply!: (response: Response) => void
  const oldPending = new Promise<Response>(resolve => { oldReply = resolve })
  const newPending = new Promise<Response>(resolve => { newReply = resolve })
  let posts = 0
  const ui = await mountEntry(async url => {
    if (url === '/api/config') return json({ demo: true })
    return ++posts === 1 ? oldPending : newPending
  })
  const work = (id: string) => json({ id, title: '合成作品', seed: '作者素材', config: {}, createdAt: 'created' })
  try {
    await editMaterial(ui.host, '作者素材')
    await act(async () => button(ui.host, '开始创作').click())
    expect([...ui.host.querySelectorAll('button')].some(item => item.textContent === '停止等待并保留输入')).toBe(true)
    await act(async () => button(ui.host, '停止等待并保留输入').click())
    expect(ui.host.textContent).toContain('创建结果尚未确认')
    expect(ui.host.querySelector('textarea')!.value).toBe('作者素材')
    await act(async () => button(ui.host, '开始一次新的创建').click())
    await act(async () => button(ui.host, '仍然新建作品').click())
    expect(posts).toBe(2)
    await act(async () => oldReply(work('late-old-work')))
    expect(ui.created).not.toHaveBeenCalled()
    expect(button(ui.host, '处理中……').disabled).toBe(true)
    await act(async () => newReply(work('new-work')))
    expect(ui.created).toHaveBeenCalledExactlyOnceWith('new-work')
  } finally { await act(async () => { oldReply(work('late-old-work')); newReply(work('new-work')) }); await ui.dispose() }
})


it('protects a file reception synchronously when Back is activated before the loading render', async () => {
  let finish!: (text: string) => void
  const pending = new Promise<string>(resolve => { finish = resolve })
  const ui = await mountEntry()
  try {
    const file = ui.host.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(file, 'files', { configurable: true, value: [{ name: 'slow.txt', text: () => pending, arrayBuffer: async () => new ArrayBuffer(0) }] })
    const back = button(ui.host, '← 返回书架')
    await act(async () => { file.dispatchEvent(new Event('change', { bubbles: true })); back.click() })
    expect(ui.back).not.toHaveBeenCalled()
    expect(ui.host.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => button(ui.host, '继续编辑').click())
    await act(async () => finish('仍会接收的素材'))
    expect(ui.host.querySelector('textarea')!.value).toBe('仍会接收的素材')
  } finally { await act(async () => finish('仍会接收的素材')); await ui.dispose() }
})


it('releases the old page guard after confirmed departure and ignores a later creation reply', async () => {
  let reply!: (response: Response) => void
  const pending = new Promise<Response>(resolve => { reply = resolve })
  const ui = await mountEntry(async url => url === '/api/config' ? json({ demo: true }) : pending)
  const result = () => json({ id: 'late-work', title: '合成作品', seed: '作者素材', config: {}, createdAt: 'created' })
  try {
    await editMaterial(ui.host, '作者素材')
    await act(async () => button(ui.host, '开始创作').click())
    await act(async () => button(ui.host, '← 返回书架').click())
    await act(async () => button(ui.host, '放弃输入并离开').click())
    expect(ui.back).toHaveBeenCalledTimes(1)
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(false)
    await act(async () => reply(result()))
    expect(ui.created).not.toHaveBeenCalled()
  } finally { await act(async () => reply(result())); await ui.dispose() }
})


it.each(['500', 'malformed-400', 'other-command', 'wrong-created-work'] as const)('preserves an unconfirmed %s creation without unsafe retry or raw exception text', async scenario => {
  let posts = 0
  const ui = await mountEntry(async url => {
    if (url === '/api/config') return json({ demo: true })
    posts++
    if (scenario === '500') return json({ code: 'internal-error', message: 'PRIVATE_SERVER_SENTINEL', retryable: false }, 500)
    if (scenario === 'malformed-400') return new Response('<html>PRIVATE_SERVER_SENTINEL</html>', { status: 400 })
    if (scenario === 'other-command') return json({ code: 'version-conflict', message: 'another operation', retryable: false,
      command: { kind: 'request-rejected', requestId: '11111111-1111-4111-8111-111111111111', operation: 'approve-beat',
        executionMode: 'demo', latencyMs: 0, attemptIds: [], writeOutcome: 'not-committed', failureStage: 'request' } }, 409)
    return json({ id: 'different-work', title: '其他作品', seed: '其他素材', config: {}, createdAt: 'created' })
  })
  try {
    await editMaterial(ui.host, '作者素材')
    await act(async () => button(ui.host, '开始创作').click())
    expect(ui.host.textContent).toContain('创建结果尚未确认')
    expect(ui.host.textContent).not.toContain('PRIVATE_SERVER_SENTINEL')
    expect(ui.host.querySelector('textarea')!.value).toBe('作者素材')
    expect(button(ui.host, '开始创作').disabled).toBe(true)
    await editMaterial(ui.host, '')
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    expect(posts).toBe(1)
    expect(ui.created).not.toHaveBeenCalled()
  } finally { await ui.dispose() }
})

it('keeps a legal bare creation rejection editable and accepts only the author next explicit submission', async () => {
  let posts = 0
  const ui = await mountEntry(async url => {
    if (url === '/api/config') return json({ demo: true })
    if (++posts === 1) return json({ code: 'invalid-input', message: 'PRIVATE_SERVER_SENTINEL', retryable: false }, 400)
    return json({ id: 'accepted-work', title: '合成作品', seed: '作者素材', config: {}, createdAt: 'created' })
  })
  try {
    await editMaterial(ui.host, '作者素材')
    await act(async () => button(ui.host, '开始创作').click())
    expect(ui.host.textContent).toContain('创建请求被拒绝')
    expect(ui.host.textContent).not.toContain('创建结果尚未确认')
    expect(ui.host.textContent).not.toContain('PRIVATE_SERVER_SENTINEL')
    expect(ui.host.querySelector('textarea')!.value).toBe('作者素材')
    expect(button(ui.host, '开始创作').disabled).toBe(false)
    expect(posts).toBe(1)
    await act(async () => button(ui.host, '开始创作').click())
    expect(ui.created).toHaveBeenCalledExactlyOnceWith('accepted-work')
    expect(posts).toBe(2)
  } finally { await ui.dispose() }
})

it('ignores a creation result after unmounting the owner page', async () => {
  let reply!: (response: Response) => void
  const pending = new Promise<Response>(resolve => { reply = resolve })
  const ui = await mountEntry(async url => url === '/api/config' ? json({ demo: true }) : pending)
  await editMaterial(ui.host, '作者素材')
  await act(async () => button(ui.host, '开始创作').click())
  await ui.dispose()
  await act(async () => reply(json({ id: 'late-work', title: '合成作品', seed: '作者素材', config: {}, createdAt: 'created' })))
  expect(ui.created).not.toHaveBeenCalled()
})

it('appends files in selection order even when the second file is ready first, preserving edits made during reading', async () => {
  let first!: (text: string) => void, second!: (text: string) => void
  const firstRead = new Promise<string>(resolve => { first = resolve }), secondRead = new Promise<string>(resolve => { second = resolve })
  const ui = await mountEntry()
  try {
    const input = ui.host.querySelector<HTMLInputElement>('input[type="file"]')!
    const pick = async (name: string, text: () => Promise<string>) => {
      Object.defineProperty(input, 'files', { configurable: true, value: [{ name, text, arrayBuffer: async () => new ArrayBuffer(0) }] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    }
    await editMaterial(ui.host, '最初的输入')
    await pick('A.txt', () => firstRead)
    await pick('B.md', () => secondRead)
    await act(async () => second('第二份文档'))
    await editMaterial(ui.host, '读取期间的修改')
    expect(ui.host.querySelector('textarea')!.value).toBe('读取期间的修改')
    await act(async () => first('第一份文档'))
    expect(ui.host.querySelector('textarea')!.value).toBe('读取期间的修改\n\n第一份文档\n\n第二份文档')
    expect(button(ui.host, '开始创作').disabled).toBe(false)
  } finally { await act(async () => { first('第一份文档'); second('第二份文档') }); await ui.dispose() }
})

it.each(['text', 'error'] as const)('cancels only file reception and refuses late %s while accepting a fresh selection', async outcome => {
  let late!: (text: string) => void, failLate!: (error: Error) => void
  const pending = new Promise<string>((resolve, reject) => { late = resolve; failLate = reject })
  const ui = await mountEntry()
  try {
    await editMaterial(ui.host, '保留的输入')
    const input = ui.host.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'old.txt', text: () => pending, arrayBuffer: async () => new ArrayBuffer(0) }] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => button(ui.host, '取消本页追加').click())
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'new.txt', text: async () => '新选文件', arrayBuffer: async () => new ArrayBuffer(0) }] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => { if (outcome === 'text') late('不应出现的旧文件'); else failLate(new Error('OLD_FILE_ERROR_SENTINEL')) })
    expect(ui.host.querySelector('textarea')!.value).toBe('保留的输入\n\n新选文件')
    expect(ui.host.textContent).toContain('已读取《new.txt》')
    expect(ui.host.textContent).not.toContain('不应出现的旧文件')
    expect(ui.host.textContent).not.toContain('OLD_FILE_ERROR_SENTINEL')
    expect(ui.host.textContent).not.toContain('正在读取素材')
    expect(ui.created).not.toHaveBeenCalled()
  } finally { await act(async () => late('不应出现的旧文件')); await ui.dispose() }
})

it('does not deliver an old page file reception to a fresh Entry owner', async () => {
  let late!: (text: string) => void
  const pending = new Promise<string>(resolve => { late = resolve })
  const old = await mountEntry()
  const input = old.host.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'old.txt', text: () => pending, arrayBuffer: async () => new ArrayBuffer(0) }] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await old.dispose()
  const fresh = await mountEntry()
  try {
    await editMaterial(fresh.host, '新页面输入')
    await act(async () => late('旧页面的迟到文件'))
    expect(fresh.host.querySelector('textarea')!.value).toBe('新页面输入')
    expect(fresh.host.textContent).not.toContain('old.txt')
    expect(old.created).not.toHaveBeenCalled()
  } finally { await fresh.dispose() }
})


it('does not erase an earlier unknown creation when a separate new intent is legally rejected', async () => {
  let posts = 0
  const ui = await mountEntry(async url => {
    if (url === '/api/config') return json({ demo: true })
    if (++posts === 1) throw new Error('synthetic response loss')
    return json({ code: 'invalid-input', message: 'new request rejected', retryable: false }, 400)
  })
  try {
    await editMaterial(ui.host, '保留的作者素材')
    await act(async () => button(ui.host, '开始创作').click())
    await act(async () => button(ui.host, '开始一次新的创建').click())
    await act(async () => button(ui.host, '仍然新建作品').click())
    expect(ui.host.textContent).toContain('创建请求被拒绝')
    expect(ui.host.textContent).toContain('创建结果尚未确认')
    expect(button(ui.host, '开始创作').disabled).toBe(true)
    expect(button(ui.host, '开始一次新的创建')).toBeDefined()
    expect(ui.host.querySelector('textarea')!.value).toBe('保留的作者素材')
    expect(posts).toBe(2)
  } finally { await ui.dispose() }
})
