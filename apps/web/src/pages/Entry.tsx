import { useRef, useState } from 'react'
import { createWork } from '../api.js'
import { parseFile } from '../file-parser.js'

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
  const fileRef = useRef<HTMLInputElement>(null)

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

  const submit = async () => {
    if (!text.trim()) {
      setError('请输入脑洞或上传文档')
      return
    }
    setError(null)
    try {
      const work = await createWork({ seed: text.trim(), title: title.trim() || undefined })
      onCreated(work.id)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 640 }}>
      <button onClick={onBack} style={{ marginBottom: 16 }}>
        ← 返回书架
      </button>
      <h1>开始创作</h1>
      <p style={{ color: '#666' }}>输入你的脑洞、设定或故事主线（也可以上传文档）。</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="一句话脑洞，或整段设定 / 主线 / 模板文本……"
        rows={10}
        style={{
          width: '100%',
          padding: 12,
          fontSize: 15,
          borderRadius: 8,
          border: '1px solid #ddd',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={() => fileRef.current?.click()}>上传文档</button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: 'none' }}
          onChange={(e) => onFiles(e.target.files)}
        />
        {notice && <span style={{ color: '#2a7' }}>{notice}</span>}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="标题（可选，留空取开头）"
        style={{
          width: '100%',
          marginTop: 16,
          padding: 10,
          borderRadius: 8,
          border: '1px solid #ddd',
          boxSizing: 'border-box',
        }}
      />
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button onClick={submit} style={{ marginTop: 16, padding: '10px 24px', fontSize: 15 }}>
        创建作品
      </button>
    </main>
  )
}
