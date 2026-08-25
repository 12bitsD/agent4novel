import { useEffect, useRef, useState } from 'react'
import type { InterviewAnswer } from '@agent4novel/contracts'
import { advance, answerInterview, createWork, getConfig } from '../api.js'
import type { AppConfig } from '../api.js'
import { ACCEPTED_FILE_TYPES, parseFile } from '../file-parser.js'

type Phase = 'input' | 'interview'

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 12,
  fontSize: 15,
  borderRadius: 8,
  border: '1px solid #ddd',
  boxSizing: 'border-box',
}

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
  const [phase, setPhase] = useState<Phase>('input')
  const [workId, setWorkId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<string[]>([])
  const [answers, setAnswers] = useState<string[]>([])
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

  // 提交：先落库创建作品 → advance；interview 开关开则原地转对话式问答，否则直跳创作界面
  const submit = async () => {
    if (!text.trim()) {
      setError('请输入脑洞或上传文档')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const work = await createWork({ seed: text.trim(), title: title.trim() || undefined })
      const state = await advance(work.id)
      if (state.stage === 'awaiting-interview' && state.pendingInterview) {
        setWorkId(work.id)
        setQuestions(state.pendingInterview.questions)
        setAnswers(state.pendingInterview.questions.map(() => ''))
        setPhase('interview')
      } else {
        onCreated(work.id)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const submitAnswers = async (skip: boolean) => {
    if (!workId) return
    setError(null)
    setBusy(true)
    try {
      const pairs: InterviewAnswer[] = skip
        ? []
        : questions
            .map((q, i) => ({ question: q, answer: answers[i] ?? '' }))
            .filter((a) => a.answer.trim().length > 0)
      await answerInterview(workId, pairs)
      onCreated(workId)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 640 }}>
      <button onClick={onBack} style={{ marginBottom: 16 }}>
        ← 返回书架
      </button>
      {config?.demo && (
        <p
          style={{
            padding: '8px 12px',
            background: '#fff8e0',
            borderRadius: 8,
            color: '#8a6d00',
            fontSize: 14,
          }}
        >
          演示模式（未配置 DEEPSEEK_API_KEY）：当前由内置 fake 生成示例内容
        </p>
      )}

      {phase === 'interview' ? (
        <>
          <h1>补全几个问题</h1>
          <p style={{ color: '#666' }}>预处理需要你把模糊的点补清楚（答不了的可以留空或跳过）。</p>
          {questions.map((q, i) => (
            <label key={i} style={{ display: 'block', marginBottom: 14 }}>
              <strong>
                {i + 1}. {q}
              </strong>
              <textarea
                rows={2}
                value={answers[i] ?? ''}
                onChange={(e) =>
                  setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
                }
                style={{ ...fieldStyle, marginTop: 6, fontSize: 14 }}
              />
            </label>
          ))}
          {error && <p style={{ color: 'crimson' }}>{error}</p>}
          <button
            onClick={() => submitAnswers(false)}
            disabled={busy}
            style={{ padding: '10px 24px', fontSize: 15 }}
          >
            提交作答
          </button>
          <button
            onClick={() => submitAnswers(true)}
            disabled={busy}
            style={{ padding: '10px 24px', fontSize: 15, marginLeft: 12, color: '#666' }}
          >
            跳过，直接生成
          </button>
        </>
      ) : (
        <>
          <h1>开始创作</h1>
          <p style={{ color: '#666' }}>输入你的脑洞、设定或故事主线（也可以上传文档）。</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="一句话脑洞，或整段设定 / 主线 / 模板文本……"
            rows={10}
            style={fieldStyle}
          />
          <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={() => fileRef.current?.click()}>上传文档</button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              style={{ display: 'none' }}
              onChange={(e) => onFiles(e.target.files)}
            />
            {notice && <span style={{ color: '#2a7' }}>{notice}</span>}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题（可选，留空取开头）"
            style={{ ...fieldStyle, marginTop: 16, padding: 10 }}
          />
          {error && <p style={{ color: 'crimson' }}>{error}</p>}
          <button
            onClick={submit}
            disabled={busy}
            style={{ marginTop: 16, padding: '10px 24px', fontSize: 15 }}
          >
            {busy ? '处理中……' : '开始创作'}
          </button>
        </>
      )}
    </main>
  )
}
