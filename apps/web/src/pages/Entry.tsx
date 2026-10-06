import { useEffect, useId, useRef, useState } from 'react'
import { seedCharBudget, type WorkCreateRequest } from '@agent4novel/contracts'
import { createWork, getConfig } from '../api.js'
import type { AppConfig } from '../api.js'
import { ACCEPTED_FILE_TYPES, parseFile } from '../file-parser.js'
import { btnPrimary, btnSecondary, fieldStyle } from '../ui.js'
import { ConfirmDialog } from '../ConfirmDialog.js'

const mainFieldStyle: React.CSSProperties = { ...fieldStyle, padding: 12, fontSize: 15 }

// 超长素材预提示(#3c 决策 17):截断统一收在 server prompt 组装处,前端只提前告知;budget 单源在 contracts
const SEED_WARN_CHARS = seedCharBudget

export default function Entry({
  onBack,
  onCreated,
}: {
  onBack: () => void
  onCreated: (workId: string) => void
}) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [creationUnknown, setCreationUnknown] = useState(false)
  const [newIntent, setNewIntent] = useState<WorkCreateRequest | null>(null)
  const [readingFiles, setReadingFiles] = useState(0)
  const active = useRef(false)
  const commandSequence = useRef(0)
  const creationPhase = useRef<'idle' | 'submitting' | 'unknown' | 'done'>('idle')
  const navigated = useRef(false)
  const unconfirmedCreation = useRef(false)
  const parseEpoch = useRef(0)
  const pendingFiles = useRef(0)
  const parseQueue = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    active.current = true
    return () => { active.current = false; commandSequence.current++; parseEpoch.current++ }
  }, [])
  const hasLocalInput = !!text.trim() || !!title.trim()
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (!navigated.current && creationPhase.current !== 'done' && (hasLocalInput || busy || creationUnknown || readingFiles > 0)) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [hasLocalInput, busy, creationUnknown, readingFiles])
  const fileRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()

  useEffect(() => {
    getConfig()
      .then(value => { if (active.current && !navigated.current) setConfig(value) })
      .catch(() => {})
  }, [])

  const cancelFileReception = () => {
    parseEpoch.current++; pendingFiles.current = 0
    setReadingFiles(0); parseQueue.current = Promise.resolve()
    setNotice('已取消本页接收文件内容。')
  }
  const leave = () => {
    if (navigated.current) return
    navigated.current = true; creationPhase.current = 'done'; commandSequence.current++
    setLeaving(false); cancelFileReception(); onBack()
  }
  const onFiles = (files: FileList | null) => {
    if (!active.current || navigated.current || creationPhase.current === 'submitting' || creationPhase.current === 'done' || !files?.length) return
    const file = files[0], epoch = parseEpoch.current
    pendingFiles.current++; setReadingFiles(pendingFiles.current); setError(null)
    const read = async () => {
      if (!active.current || epoch !== parseEpoch.current) return
      const result = await parseFile(file)
      if (!active.current || epoch !== parseEpoch.current) return
      if (result.ok) {
        setText(current => current ? `${current}\n\n${result.text}` : result.text)
        setNotice(`已读取《${file.name}》`); setError(null)
      } else setError(`文件解析失败：${result.error}——请粘贴文本代替`)
    }
    parseQueue.current = parseQueue.current.then(read, read).finally(() => {
      if (active.current && epoch === parseEpoch.current) { pendingFiles.current--; setReadingFiles(pendingFiles.current) }
    })
  }

  // 只创建作品并跳创作界面；生成由 Workspace 触发，advance 可能链式执行多个模型步骤，
  // 耗时取决于 provider，不挂在这个创建请求上。
  const submit = async (candidate?: WorkCreateRequest, explicitNewIntent = false) => {
    if (!active.current || navigated.current || creationPhase.current === 'submitting' || creationPhase.current === 'done'
      || creationPhase.current === 'unknown' && !explicitNewIntent) return
    if (pendingFiles.current > 0) { setError('请等待素材读取完成，或先取消本页追加。'); return }
    const input = candidate ?? { seed: text.trim(), title: title.trim() || undefined }
    if (!input.seed) { setError('请输入脑洞或上传文档'); return }
    creationPhase.current = 'submitting'
    setCreationUnknown(unconfirmedCreation.current); setError(null); setBusy(true)
    const sequence = ++commandSequence.current
    try {
      const work = await createWork(input)
      if (active.current && !navigated.current && sequence === commandSequence.current) {
        creationPhase.current = 'done'; onCreated(work.id)
      }
    } catch (err) {
      if (!active.current || navigated.current || sequence !== commandSequence.current) return
      const failure = err as { status?: number; code?: string; retryable?: boolean; writeOutcome?: string; command?: unknown }
      const rejected = Number.isInteger(failure?.status) && failure.status! >= 400 && failure.status! < 500
        && typeof failure.code === 'string' && typeof failure.retryable === 'boolean'
        && failure.writeOutcome !== 'unknown' && failure.command === undefined
      if (!rejected) unconfirmedCreation.current = true
      creationPhase.current = unconfirmedCreation.current ? 'unknown' : 'idle'
      setCreationUnknown(unconfirmedCreation.current)
      setError(rejected ? unconfirmedCreation.current
        ? '本次创建请求被拒绝，输入已保留；更早的创建结果仍未确认。'
        : '创建请求被拒绝，素材和标题已保留，请检查后重新提交。' : null)
    } finally {
      if (active.current && sequence === commandSequence.current) setBusy(false)
    }
  }
  const stopWaiting = () => {
    if (creationPhase.current !== 'submitting') return
    // Withdraw only this page's receipt/navigation authority; the server request may finish.
    commandSequence.current++; creationPhase.current = 'unknown'; unconfirmedCreation.current = true
    setBusy(false); setCreationUnknown(true); setError(null)
  }
  const askNewCreation = () => {
    if (creationPhase.current !== 'unknown' || pendingFiles.current > 0) return
    if (!text.trim()) { setError('请输入脑洞或上传文档'); return }
    setNewIntent({ seed: text.trim(), title: title.trim() || undefined })
  }

  return (
    <main className="entry-page">
      <button
        onClick={() => { if (hasLocalInput || busy || creationUnknown || readingFiles > 0) setLeaving(true); else leave() }}
        style={{ ...btnSecondary, padding: '4px 10px', fontSize: 13, marginBottom: 16 }}
      >
        ← 返回书架
      </button>
      {config?.demo && (
        <p className="status-message" role="status">
          演示模式（未配置可用模型凭据）：当前由内置 fake 生成示例内容
        </p>
      )}

      <header className="page-heading">
        <div>
          <p className="eyebrow">新作品</p>
          <h1>开始创作</h1>
          <p className="page-lede">输入你的脑洞、设定或故事主线（也可以上传文档）。</p>
        </div>
      </header>
      <section className="entry-form surface">
        <label className="field-label" htmlFor={`${fieldId}-material`}>创作素材</label>
        <textarea
          id={`${fieldId}-material`}
          className="entry-material"
          value={text}
          disabled={busy || newIntent !== null}
          onChange={(e) => { if (creationPhase.current !== 'submitting' && creationPhase.current !== 'done') setText(e.target.value) }}
          placeholder="一句话脑洞，或整段设定 / 主线 / 模板文本……"
          rows={10}
          style={mainFieldStyle}
        />
        {text.length > SEED_WARN_CHARS && (
          <p className="status-message" role="status">
            素材较长（{text.length.toLocaleString()} 字），生成时将截取前 {SEED_WARN_CHARS.toLocaleString()} 字。
          </p>
        )}
        <div className="action-row" style={{ marginTop: 12 }}>
          <button disabled={busy || newIntent !== null} onClick={() => fileRef.current?.click()} style={btnSecondary}>
            上传文档
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            style={{ display: 'none' }}
            disabled={busy || newIntent !== null}
            onChange={(e) => { onFiles(e.target.files); e.target.value = '' }}
          />
          <small className="page-lede">TXT / MD / DOCX / PDF</small>
          {readingFiles > 0 && <span role="status">正在读取素材文件…（{readingFiles}）<button type="button" style={btnSecondary} onClick={cancelFileReception}>取消本页追加</button></span>}
          {notice && <span role="status" style={{ color: 'var(--ok)' }}>{notice}</span>}
        </div>
        <label className="field-label" htmlFor={`${fieldId}-title`} style={{ marginTop: 24 }}>作品标题（可选）</label>
        <input
          id={`${fieldId}-title`}
          value={title}
          disabled={busy || newIntent !== null}
          onChange={(e) => { if (creationPhase.current !== 'submitting' && creationPhase.current !== 'done') setTitle(e.target.value) }}
          placeholder="标题（可选，留空取开头）"
          style={{ ...mainFieldStyle, padding: 10 }}
        />
        {error && <p role="alert" className="status-message status-error">{error}</p>}
        {creationUnknown && creationPhase.current !== 'done' && <div className="status-message" role="status">
          <p>有创建结果尚未确认。先前请求可能已创建作品；本页没有精确查询或安全重试能力。请先回书架核对，开始新的创建可能产生重复作品。</p>
          <button type="button" disabled={busy || readingFiles > 0} style={btnSecondary} onClick={askNewCreation}>开始一次新的创建</button>
        </div>}
        <div className="action-row entry-submit" style={{ marginTop: 24 }}>
          <p className="page-lede">创建作品后，在工作台生成并审阅创作方向。</p>
          <button onClick={() => void submit()} disabled={busy || readingFiles > 0 || creationPhase.current !== 'idle'} style={btnPrimary}>
            {busy ? '处理中……' : '开始创作'}
          </button>
          {busy && <button type="button" style={btnSecondary} onClick={stopWaiting}>停止等待并保留输入</button>}
        </div>
      </section>
      {leaving && <ConfirmDialog title={creationUnknown || busy ? '离开创建结果未确认的页面？' : '离开未创建的作品？'} description={creationUnknown || busy ? '创建请求可能继续处理。离开会放弃本页输入，之后可从书架核对作品；不会取消服务器创建。' : '素材和标题尚未提交。离开会放弃本页输入。'}
        cancelLabel="继续编辑" confirmLabel="放弃输入并离开" onCancel={() => setLeaving(false)} onConfirm={leave} />}
      {newIntent && <ConfirmDialog title="明确开始一次新的创建？" description="先前创建可能已成功，此操作将发送新的创建请求，可能产生重复作品。请先回书架核对；这不是对原请求的安全重试。"
        cancelLabel="保留当前输入" confirmLabel="仍然新建作品" onCancel={() => setNewIntent(null)} onConfirm={() => { const input = newIntent; setNewIntent(null); void submit(input, true) }} />}
    </main>
  )
}
