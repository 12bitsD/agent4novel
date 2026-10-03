import { useEffect, useRef, useState } from 'react'
import { authorConfigDocumentSchema, authorConfigLimits, authorStepIds,
  type AuthorConfigDocument, type AuthorConfigSave, type AuthorConfigView, type AgentFileUpload, type AuthorStepId } from '@agent4novel/contracts'
import { getAgentFile, getAuthorConfig, saveAuthorConfig, uploadAgentFile } from '../api.js'
import { btnPrimary, btnSecondary, fieldStyle } from '../ui.js'

type Frozen = { kind: 'save'; request: AuthorConfigSave } | { kind: 'upload'; request: AgentFileUpload }
type Guard = { dirty: boolean; locked: boolean }
type Controls = AuthorConfigDocument['defaults']
const stepNames: Record<AuthorStepId, string> = { caption: '提炼稿', creative: '创意稿', outline: '大纲', setting: '设定', beat: '章纲', prose: '正文' }
export default function AuthorConfigPanel({ workId, onGuard }: { workId: string; onGuard: (guard: Guard) => void }) {
  const [view, setView] = useState<AuthorConfigView | null>(null)
  const [baseline, setBaseline] = useState<{ revision: number; document: AuthorConfigDocument } | null>(null)
  const [draft, setDraft] = useState<AuthorConfigDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [frozen, setFrozen] = useState<Frozen | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [promptText, setPromptText] = useState('')
  const [skillText, setSkillText] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const active = useRef(true)
  const observed = useRef<AuthorConfigView | null>(null)
  const acceptView = (value: AuthorConfigView) => {
    const prior = observed.current
    if (prior && (value.revision < prior.revision || prior.files.some(file => !value.files.some(next => next.id === file.id)))) return false
    observed.current = value; setView(value); return true
  }
  const dirty = !!frozen || !!promptText || !!skillText || !!draft && !!baseline && JSON.stringify(draft) !== JSON.stringify(baseline.document)
  const locked = busy || frozen !== null
  useEffect(() => { onGuard({ dirty, locked }) }, [dirty, locked, onGuard])
  useEffect(() => {
    active.current = true
    void getAuthorConfig(workId).then(value => {
      if (!active.current) return
      if (!acceptView(value)) return
      setBaseline({ revision: value.revision, document: value.document }); setDraft(structuredClone(value.document))
    }).catch(() => { if (active.current) setError('读取配置失败，请重试。') })
    return () => { active.current = false }
  }, [workId])
  const refresh = async (replace = false) => {
    try {
      const value = await getAuthorConfig(workId)
      if (!active.current) return
      if (!acceptView(value)) return
      if (replace || !draft || (!dirty && !frozen)) {
        setBaseline({ revision: value.revision, document: value.document }); setDraft(structuredClone(value.document)); setError(null)
      }
    } catch { if (active.current) setError('读取配置失败；本页内容和原请求已保留。') }
  }
  const run = async (operation: Frozen) => {
    if (busy) return
    const hadUnknownWrite = frozen !== null
    setFrozen(operation); setBusy(true); setError(null)
    let writeAccepted = false
    try {
      if (operation.kind === 'save') {
        await saveAuthorConfig(workId, operation.request)
        writeAccepted = true
        const value = await getAuthorConfig(workId)
        if (!active.current) return
        if (!acceptView(value)) throw new Error('configuration read is stale')
        setBaseline({ revision: value.revision, document: value.document }); setDraft(structuredClone(value.document))
      } else {
        const file = await uploadAgentFile(workId, operation.request)
        writeAccepted = true
        const value = await getAuthorConfig(workId)
        if (!active.current) return
        if (!acceptView(value)) throw new Error('file library read is stale')
        setDraft(old => old && { ...old, defaults: file.kind === 'prompt' ? { ...old.defaults, systemPromptRef: file.id }
          : { ...old.defaults, skills: (old.defaults.skills?.length ?? 0) < authorConfigLimits.skillsPerStep ? [...(old.defaults.skills ?? []), file.id] : old.defaults.skills } })
        if (file.kind === 'prompt') setPromptText(''); else setSkillText('')
      }
      if (active.current) setFrozen(null)
    } catch (cause) {
      if (!active.current) return
      const status = (cause as { status?: number }).status
      if (!hadUnknownWrite && !writeAccepted && status !== undefined && status < 500 && (cause as { writeOutcome?: string }).writeOutcome !== 'unknown') {
        setFrozen(null); setError(status === 409 ? '配置版本已变化。当前修改保留，请查看服务器配置后再决定。' : '配置或文件无效，请检查格式、模型与预算。')
      } else setError('写入结果尚未确认。原请求已冻结，可刷新查看或明确重试原请求；不会自动重发。')
    } finally { if (active.current) setBusy(false) }
  }
  const save = () => {
    if (!draft || !baseline || locked) return
    const parsed = authorConfigDocumentSchema.safeParse(draft)
    if (!parsed.success) { setError('配置无效，请检查字段范围和 Skill 数量。'); return }
    void run({ kind: 'save', request: { requestId: crypto.randomUUID(), expectedRevision: baseline.revision, document: parsed.data } })
  }
  const change = (target: 'defaults' | AuthorStepId, key: keyof Controls, value: unknown) => setDraft(old => {
    if (!old) return old
    const updated = { ...(target === 'defaults' ? old.defaults : old.steps[target] ?? {}), [key]: value }
    return target === 'defaults' ? { ...old, defaults: updated } : { ...old, steps: { ...old.steps, [target]: updated } }
  })
  const controls = (target: 'defaults' | AuthorStepId) => {
    if (!draft || !view) return null
    const c = target === 'defaults' ? draft.defaults : draft.steps[target] ?? {}
    const prefix = target === 'defaults' ? '作品默认' : stepNames[target]
    return <fieldset disabled={locked} className="config-fieldset">
      <div className="config-fields">
      <label className="config-field">{prefix}模型 <select style={fieldStyle} aria-label={`${prefix}模型`} value={c.model ?? ''} onChange={e => change(target, 'model', e.target.value || undefined)}>
        <option value="">{target === 'defaults' ? '跟随启动配置' : '继承作品默认'}</option>
        <option value="deepseek:deepseek-chat">DeepSeek Chat</option><option value="deepseek:deepseek-reasoner">DeepSeek Reasoner</option><option value="longcat:LongCat-2.0">LongCat 2.0</option>
      </select></label>
      <label className="config-field">Prompt <select style={fieldStyle} aria-label={`${prefix}Prompt`} value={c.systemPromptRef === null ? '__none' : c.systemPromptRef ?? ''} onChange={e => change(target, 'systemPromptRef', e.target.value === '__none' ? null : e.target.value || undefined)}>
        <option value="">{target === 'defaults' ? '内置任务指导' : '继承作品默认'}</option><option value="__none">仅内置任务指导</option>
        {view.files.filter(f => f.kind === 'prompt').map(file => <option key={file.id} value={file.id}>{file.name} · {file.sha256.slice(0, 8)}</option>)}
      </select></label>
      </div>
      <div className="config-skills">
      <p className="setting-muted">Skill：{c.skills === undefined ? '继承' : c.skills.length ? '使用以下选择' : '无'}（最多4个）</p>
      {view.files.filter(f => f.kind === 'skill').map(file => <label key={file.id} className="config-skill-option">
        <input type="checkbox" checked={(c.skills ?? (target === 'defaults' ? [] : draft.defaults.skills ?? [])).includes(file.id)} onChange={e => {
          const ids = c.skills ?? (target === 'defaults' ? [] : draft.defaults.skills ?? [])
          change(target, 'skills', e.target.checked ? [...ids, file.id] : ids.filter(id => id !== file.id))
        }} />{file.name} · {file.description}
      </label>)}
      <div className="setting-actions">
      <button type="button" style={btnSecondary} onClick={() => change(target, 'skills', undefined)}>继承 Skill</button>
      <button type="button" style={btnSecondary} onClick={() => change(target, 'skills', [])}>清空 Skill</button>
      </div>
      </div>
      <div className="config-number-row"><label className="config-field">Thinking <select style={fieldStyle} aria-label={`${prefix}Thinking`} value={c.thinking ?? ''} onChange={e => change(target, 'thinking', e.target.value || undefined)}>
        <option value="">继承</option><option value="disabled">关闭（LongCat）</option><option value="enabled">开启（LongCat）</option>
      </select></label>{(['temperature', 'topP', 'directionCount'] as const).map(key => <label key={key} className="config-field">{key}
        <input aria-label={`${prefix}${key}`} type="number" min={key === 'directionCount' ? 1 : 0} max={key === 'directionCount' ? 3 : 1} step={key === 'directionCount' ? 1 : 0.05}
          value={c[key] ?? ''} onChange={e => change(target, key, e.target.value === '' ? undefined : Number(e.target.value))} style={fieldStyle} />
      </label>)}</div>
    </fieldset>
  }
  return <section aria-label="Agent 配置" className="author-config">
    <h2 className="section-heading">Agent 配置</h2><p className="setting-muted">只影响下一次生成，已有内容与通过状态保持。正在运行的生成使用开始时的配置。</p>
    {view && <p className="config-status">配置版本 {view.revision} · {dirty ? '未保存的修改或请求待确认' : '已保存'} · {view.effective[0]?.executionMode === 'demo' ? '演示模式，使用 FakeStep' : '真实模型'}</p>}
    {error && <p className="setting-notice" role="alert">{error}</p>}
    <div className="setting-actions">
    <button type="button" style={btnSecondary} disabled={busy} onClick={() => void refresh()}>刷新配置</button>
    {!frozen && dirty && <button type="button" style={btnSecondary} disabled={busy} onClick={() => void refresh(true)}>加载服务器配置</button>}
    {frozen && <button type="button" style={btnPrimary} disabled={busy} onClick={() => void run(frozen)}>重试原请求</button>}
    </div>
    {draft && <>
      <fieldset disabled={locked} className="config-fieldset config-preferences">{(['style', 'genre', 'payoff'] as const).map((key, index) => <label key={key} className="config-field">
        {['文风', '题材', '爽点偏好'][index]} <input aria-label={['文风', '题材', '爽点偏好'][index]} list={`author-${workId}-${key}`} maxLength={500} value={draft.preferences[key] ?? ''}
          onInput={e => { const value = e.currentTarget.value; setDraft(old => old && { ...old, preferences: { ...old.preferences, [key]: value } }) }} style={fieldStyle} />
        <datalist id={`author-${workId}-${key}`}>{(key === 'style' ? ['简洁自然', '轻松幽默', '紧张利落'] : key === 'genre' ? ['玄幻', '都市', '悬疑'] : ['成长突破', '智斗反转', '逆境翻盘']).map(value => <option key={value} value={value} />)}</datalist>
      </label>)}</fieldset>
      <p className="setting-muted">文风→正文；题材→创意稿/大纲/设定/章纲/正文；爽点→创意稿/大纲/章纲/正文。</p>
      <details className="config-disclosure"><summary>高级配置：作品默认与每步覆盖</summary><h3 className="section-heading">作品默认</h3>{controls('defaults')}
        {authorStepIds.map(id => <details className="config-disclosure" key={id}><summary>{stepNames[id]}</summary>{controls(id)}</details>)}
        <p className="setting-muted">Tools 未启用。上传 Skill 只作提示文本，不执行脚本或读取链接/附件。内置输出契约始终有效。</p>
      </details>
      <div className="setting-actions config-save"><button type="button" style={btnPrimary} disabled={locked} onClick={save}>{busy ? '正在确认配置…' : '保存配置'}</button></div>
      <details className="config-disclosure"><summary>上传 Prompt / Skill</summary>
        <fieldset disabled={locked} className="config-fieldset"><label className="config-field">作者写作指导<textarea aria-label="作者写作指导" rows={6} value={promptText} maxLength={authorConfigLimits.fileBytes} onChange={e => setPromptText(e.target.value)} style={fieldStyle} /></label>
          <button type="button" style={btnSecondary} disabled={!promptText.trim()} onClick={() => void run({ kind: 'upload', request: { requestId: crypto.randomUUID(), kind: 'prompt', text: promptText } })}>上传 Prompt</button>
          <label className="config-field config-upload">上传 SKILL.md <input type="file" accept=".md,text/markdown" onChange={async e => {
            const file = e.target.files?.[0]; if (!file) return
            try { if (file.size > authorConfigLimits.fileBytes) throw new Error(); const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); if (active.current) setSkillText(text) }
            catch { if (active.current) setError('Skill 文件必须是32KiB以内的有效UTF-8。') }
          }} /></label>
          {skillText && <><pre className="config-preview">{skillText}</pre><button type="button" style={btnSecondary} onClick={() => void run({ kind: 'upload', request: { requestId: crypto.randomUUID(), kind: 'skill', text: skillText } })}>确认上传 Skill</button></>}
        </fieldset>
        <p className="setting-muted">上传成功后还需保存配置；文件是不可变版本，新上传不会改旧操作。</p>
      </details>
    </>}
    {view && <details className="config-disclosure"><summary>查看实际配置和版本文件</summary>
      {view.effective.map(step => <p className="config-effective" key={step.id}>{stepNames[step.id]}：{step.model}（{step.provider}，{step.configured ? '已配置' : '未配置'}） · {JSON.stringify(step.generation)} · 偏好 {JSON.stringify(step.appliedPreferences)} · Prompt {step.systemPrompt?.sha256.slice(0, 12) ?? '内置'} · Skills {step.skills.map(s => `${s.name}:${s.sha256.slice(0, 12)}`).join(', ') || '无'} · Tools 未启用</p>)}
      {view.files.map(file => <p className="config-file" key={file.id}>{file.kind} {file.name} · {file.sha256.slice(0, 12)} <button type="button" style={btnSecondary} onClick={async () => {
        try { const result = await getAgentFile(workId, file.id); if (active.current) setPreview(result.text) }
        catch { if (active.current) setError('读取版本文件失败。') }
      }}>查看文件</button></p>)}
      {preview !== null && <pre className="config-preview">{preview}</pre>}
    </details>}
  </section>
}
