import { useEffect, useRef, useState } from 'react'
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
    <main style={{ padding: 24, maxWidth: 640 }}>
      <button
        onClick={onBack}
        style={{ ...btnSecondary, padding: '4px 10px', fontSize: 13, marginBottom: 16 }}
      >
        ← 返回书架
      </button>
      {config?.demo && (
        <p
          style={{
            padding: '8px 12px',
            background: 'var(--warn-bg)',
            borderRadius: 'var(--radius)',
            color: 'var(--warn-ink)',
            fontSize: 14,
          }}
        >
          演示模式（未配置可用模型凭据）：当前由内置 fake 生成示例内容
        </p>
      )}

      <h1>开始创作</h1>
      <p style={{ color: 'var(--ink-2)' }}>输入你的脑洞、设定或故事主线（也可以上传文档）。</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="一句话脑洞，或整段设定 / 主线 / 模板文本……"
        rows={10}
        style={mainFieldStyle}
      />
      {text.length > SEED_WARN_CHARS && (
        <p style={{ color: 'var(--warn-ink)', fontSize: 13 }}>
          素材较长（{text.length.toLocaleString()} 字），生成时将截取前 {SEED_WARN_CHARS.toLocaleString()} 字。
        </p>
      )}
      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
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
        {notice && <span style={{ color: 'var(--ok)' }}>{notice}</span>}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="标题（可选，留空取开头）"
        style={{ ...mainFieldStyle, marginTop: 16, padding: 10 }}
      />
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <button onClick={submit} disabled={busy} style={{ ...btnPrimary, marginTop: 16 }}>
        {busy ? '处理中……' : '开始创作'}
      </button>
    </main>
  )
}
