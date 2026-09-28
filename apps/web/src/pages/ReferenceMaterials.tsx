import { useState } from 'react'
import { beatArtifactSchema, captionContentSchema, creativeContentSchema, outlineContentSchema, settingArtifactSchema } from '@agent4novel/contracts'
import type { WorkView } from '@agent4novel/contracts'
import { initBeatReview } from '../beat-review.js'
import { initSettingReview } from '../setting-review.js'
import { btnSecondary, cardStyle } from '../ui.js'
import BeatReview from './BeatReview.js'
import CreativePoster from './CreativePoster.js'
import OutlineReview from './OutlineReview.js'
import SettingReview from './SettingReview.js'

const noop = () => {}
// Reuse the existing renderers without reopening any approved editing gate.
export default function ReferenceMaterials({ work, chapter, hiddenKinds }: { work: WorkView; chapter: number; hiddenKinds: string[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const head = (kind: string) => work.artifacts.find(a => a.kind === kind && a.humanStatus === 'approved' && (kind !== 'beat' || a.chapter === chapter))
  const creativeArtifact = head('creative')
  const creative = creativeContentSchema.safeParse(creativeArtifact?.content).data
  const outlineArtifact = head('outline')
  const outline = outlineContentSchema.safeParse(outlineArtifact?.content).data
  const setting = settingArtifactSchema.safeParse(head('setting')).data
  const beat = beatArtifactSchema.safeParse(head('beat')).data
  const caption = captionContentSchema.safeParse(head('caption')?.content).data
  const items = [{ kind: 'seed', label: '脑洞', exists: true }, { kind: 'caption', label: '提炼稿', exists: !!caption },
    { kind: 'creative', label: '创意稿', exists: !!creative }, { kind: 'outline', label: '大纲', exists: !!outline },
    { kind: 'setting', label: '设定', exists: !!setting }, { kind: 'beat', label: '本章已通过章纲', exists: !!beat }]
    .filter(item => item.exists && !hiddenKinds.includes(item.kind))
  return <section aria-label="创作资料" style={{ ...cardStyle, marginTop: 24 }}>
    <h2 style={{ fontSize: 18 }}>创作资料</h2><p className="setting-muted">查看已通过的中间产物。</p>
    <div className="setting-actions">{items.map(item => <button type="button" key={item.kind} style={btnSecondary}
      aria-expanded={open === item.kind} onClick={() => setOpen(open === item.kind ? null : item.kind)}>{item.label}</button>)}</div>
    {open === 'seed' && <p style={{ whiteSpace: 'pre-wrap' }}>{work.seed}</p>}
    {open === 'caption' && caption && <div><p className="setting-muted">输入阶段：{caption.inputStage}</p><p>{caption.summary}</p><ul>{caption.elements.map((item, i) => <li key={i}>{item.kind}：{item.content}</li>)}</ul>
      {caption.gaps.length > 0 && <><h3>待补充</h3><ul>{caption.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></>}</div>}
    {open === 'creative' && creative && creativeArtifact && <CreativePoster key={creativeArtifact.id} workId={work.id} content={creative}
      headVersion={creativeArtifact.version} caption={caption ?? null} readonly onChanged={noop} />}
    {open === 'outline' && outline && outlineArtifact && <OutlineReview key={outlineArtifact.id} workId={work.id} content={outline}
      headVersion={outlineArtifact.version} pack={creative?.directions[0] ?? null} readonly onChanged={noop} />}
    {open === 'setting' && setting && <SettingReview state={initSettingReview(setting)} allowApprove={false}
      onAction={noop} onApprove={noop} onConfirm={noop} onRetry={noop} />}
    {open === 'beat' && beat && <BeatReview state={initBeatReview(beat)} allowCommands={false}
      onAction={noop} onApprove={noop} onRegenerate={noop} onConfirm={noop} onRetry={noop} />}
  </section>
}
