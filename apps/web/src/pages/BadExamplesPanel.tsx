import { useEffect, useRef, useState } from 'react'
import { badExampleLimits, badExampleRequestSchema, matchesBadExample, type BadExample, type BadExampleRequest } from '@agent4novel/contracts'
import { getBadExample, listBadExamples, markBadExample, textHash } from '../api.js'
import { btnPrimary, btnSecondary, fieldStyle } from '../ui.js'

export type SavedSelection = { chapter: number; sourceArtifactId: string; sourceVersion: number; sourceText: string; start: number; end: number; text: string }
export type BadExampleGuard = { dirty: boolean; locked: boolean }
export default function BadExamplesPanel({ workId, chapter, selection, onClear, canMark, onGuard }: {
  workId: string; chapter: number; selection: SavedSelection | null; onClear: () => void; canMark: boolean; onGuard?: (guard: BadExampleGuard) => void
}) {
  const [open, setOpen] = useState(false), [note, setNote] = useState(''), [busy, setBusy] = useState(false)
  const [frozen, setFrozen] = useState<BadExampleRequest | null>(null), [items, setItems] = useState<BadExample[]>([])
  const [nextCursor, setNextCursor] = useState<number | undefined>(), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState('')
  const active = useRef(true), writing = useRef(false), sequence = useRef(0)
  const locked = busy || !!frozen, dirty = !!selection || !!note || locked
  useEffect(() => { onGuard?.({ dirty, locked }) }, [dirty, locked, onGuard])
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => { if (selection) setOpen(true) }, [selection])
  const accept = (record: BadExample) => {
    setItems(old => [record, ...old.filter(item => item.id !== record.id)])
    setFrozen(null); setNote(''); onClear(); setError(null); setNotice('已保存坏例。原文快照不会随正文后续修改改变。')
  }
  const load = async (after?: number) => {
    const current = ++sequence.current
    try {
      const page = await listBadExamples(workId, { chapter, ...(after === undefined ? {} : { after }) })
      if (!active.current || sequence.current !== current) return
      setItems(old => Array.from(new Map([...old, ...page.items].map(item => [item.id, item])).values())); setNextCursor(page.nextCursor)
    } catch { if (active.current && current === sequence.current) setError('坏例读取失败，请重试；本页选段和原请求仍保留。') }
  }
  useEffect(() => { if (open) void load() }, [open, workId, chapter])
  const write = async (request: BadExampleRequest, earlierUnknown: boolean) => {
    setFrozen(request)
    try { const record = await markBadExample(workId, request); if (active.current) accept(record) }
    catch (error) {
      if (!active.current) return
      const status = (error as { status?: number })?.status
      if (!earlierUnknown && status !== undefined && status < 500) {
        setFrozen(null); setError('标记未被接受。请检查选段是否仍属于该保存版本；本页选段和备注已保留。')
      } else setError('标记结果尚未确认。原请求已保留，请核对结果或明确重试同一请求。')
    }
  }
  const submit = async () => {
    if (writing.current || locked || !canMark || !selection) return
    writing.current = true; setBusy(true); setNotice(''); setError(null)
    onGuard?.({ dirty: true, locked: true })
    try {
      const { sourceText, ...fields } = selection
      const request = badExampleRequestSchema.safeParse({ requestId: crypto.randomUUID(), ...fields, sourceHash: await textHash(sourceText), note })
      if (!active.current) return
      if (!request.success) { setError('选段或备注超出限制，请重新选择完整文字。'); return }
      await write(request.data, false)
    } catch { if (active.current) setError('无法准备标记请求，本页选段已保留。') }
    finally { writing.current = false; if (active.current) setBusy(false) }
  }
  const recover = async (retry: boolean) => {
    if (!frozen || writing.current) return
    writing.current = true; setBusy(true); setError(null)
    try {
      if (retry) await write(frozen, true)
      else {
        const record = await getBadExample(workId, frozen.requestId)
        if (!matchesBadExample(record, workId, frozen)) throw new Error('mismatched receipt')
        if (active.current) accept(record)
      }
    } catch { if (active.current) setError('尚无法确认原标记；未找到记录也不代表先前请求不会完成。原请求仍保留。') }
    finally { writing.current = false; if (active.current) setBusy(false) }
  }
  return <section aria-label="坏例收集" style={{ marginTop: 24 }}>
    <button type="button" style={btnSecondary} disabled={locked} onClick={() => setOpen(value => !value)}>坏例收集</button>
    {open && <>
      <h3>本章坏例</h3><p className="setting-muted">在正文中选取一段文字，再标记。样本保留当时原文，供你调整写作指导；不会自动分析或改写。</p>
      {!canMark && !locked && <p role="status">请先保存并确认正文操作，再标记坏例。</p>}
      {selection && <><blockquote style={{ whiteSpace: 'pre-wrap' }}>{selection.text}</blockquote><p>选段来源：正文 v{selection.sourceVersion}</p></>}
      <label>坏例备注（可选）<textarea aria-label="坏例备注（可选）" style={fieldStyle} rows={2} maxLength={badExampleLimits.note} value={note} disabled={locked || !canMark} onChange={e => setNote(e.target.value)} /></label>
      <div className="setting-actions"><button type="button" style={btnPrimary} disabled={!selection || !canMark || locked} onClick={() => void submit()}>标记为坏例</button>
        {selection && <button type="button" style={btnSecondary} disabled={locked} onClick={onClear}>清除选段</button>}
        <button type="button" style={btnSecondary} onClick={() => void load()}>刷新坏例</button>
        {frozen && <><button type="button" disabled={busy} style={btnSecondary} onClick={() => void recover(false)}>核对标记结果</button><button type="button" disabled={busy} style={btnSecondary} onClick={() => void recover(true)}>重试标记原请求</button></>}
      </div>
      {busy && <p role="status">正在处理标记…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!items.length && <p>本章暂无已读取的坏例。</p>}
      <ol>{items.map(item => <li key={item.id}><p>正文 v{item.sourceVersion} · {item.createdAt}</p><blockquote style={{ whiteSpace: 'pre-wrap' }}>{item.text}</blockquote>{item.note && <p>备注：{item.note}</p>}</li>)}</ol>
      {nextCursor !== undefined && <button type="button" style={btnSecondary} onClick={() => void load(nextCursor)}>继续读取坏例</button>}
    </>}
  </section>
}
