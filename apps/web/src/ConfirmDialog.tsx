import { useEffect, useId, useRef } from 'react'
import { btnPrimary, btnSecondary } from './ui.js'

// 所有关闭路径都默认取消；只有危险按钮执行确认动作。
export function ConfirmDialog({ title, description, cancelLabel, confirmLabel, onCancel, onConfirm }: {
  title: string; description: string; cancelLabel: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    cancel.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <div className="setting-modal-backdrop" onClick={onCancel}>
    <div className="setting-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
        if (event.key === 'Tab') {
          const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])
          const first = focusable[0]
          const last = focusable.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <button type="button" aria-label="关闭弹窗，继续编辑" className="setting-modal-close" onClick={onCancel}>×</button>
      <div className="setting-modal-mark" aria-hidden="true">!</div>
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <div className="setting-actions">
        <button type="button" ref={cancel} style={btnSecondary} onClick={onCancel}>{cancelLabel}</button>
        <button type="button" style={btnPrimary} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>
}
