import { useEffect, useId, useRef, useState } from 'react'
import { seedCharBudget } from '@agent4novel/contracts'
import { createWork, getConfig } from '../api.js'
import type { AppConfig } from '../api.js'
import { ACCEPTED_FILE_TYPES, parseFile } from '../file-parser.js'
import { btnPrimary, btnSecondary, fieldStyle } from '../ui.js'

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
  const fileRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch(() => {})
  }, [])

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    const result = await parseFile(file)
    if (result.ok) {
      setText((t) => (t ? `${t}\n\n` : '') + result.text)
      setNotice(`已读取《${file.name}》`)
      setError(null)
    } else {
      setError(`文件解析失败：${result.error}——请粘贴文本代替`)
    }
  }

  // 只创建作品并跳创作界面；生成由 Workspace 触发，advance 可能链式执行多个模型步骤，
  // 耗时取决于 provider，不挂在这个创建请求上。
  const submit = async () => {
    if (!text.trim()) {
      setError('请输入脑洞或上传文档')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const work = await createWork({ seed: text.trim(), title: title.trim() || undefined })
      onCreated(work.id)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="entry-page">
      <button
        onClick={onBack}
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
          onChange={(e) => setText(e.target.value)}
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
          <button onClick={() => fileRef.current?.click()} style={btnSecondary}>
            上传文档
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            style={{ display: 'none' }}
            onChange={(e) => onFiles(e.target.files)}
          />
          <small className="page-lede">TXT / MD / DOCX / PDF</small>
          {notice && <span role="status" style={{ color: 'var(--ok)' }}>{notice}</span>}
        </div>
        <label className="field-label" htmlFor={`${fieldId}-title`} style={{ marginTop: 24 }}>作品标题（可选）</label>
        <input
          id={`${fieldId}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（可选，留空取开头）"
          style={{ ...mainFieldStyle, padding: 10 }}
        />
        {error && <p role="alert" className="status-message status-error">{error}</p>}
        <div className="action-row entry-submit" style={{ marginTop: 24 }}>
          <p className="page-lede">创建作品后，在工作台生成并审阅创作方向。</p>
          <button onClick={submit} disabled={busy} style={btnPrimary}>
            {busy ? '处理中……' : '开始创作'}
          </button>
        </div>
      </section>
    </main>
  )
}
