import type { ReactNode, Ref } from 'react'

export type MaterialGuard = { dirty: boolean; locked: boolean }
type Props = { label: string; title: string; description?: ReactNode; status?: ReactNode; actions?: ReactNode; children: ReactNode;
  className?: string; headerClassName?: string; actionsClassName?: string; ariaLabel: string; rootRef?: Ref<HTMLElement> }

// Presentation only: permissions, baselines and recovery callbacks stay with each material controller.
export default function MaterialFrame({ label, title, description, status, actions, children, className = '', headerClassName = '', actionsClassName = '', ariaLabel, rootRef }: Props) {
  return <section ref={rootRef} className={`material-frame ${className}`} aria-label={ariaLabel}>
    <header className={`setting-review-header material-header ${headerClassName}`}>
      <div className="review-copy"><p className="setting-eyebrow eyebrow">{label}</p><h2 className="material-title">{title}</h2>
        {description}{status && <div className="material-status">{status}</div>}</div>
      {actions && <div className={`material-actions ${actionsClassName}`}>{actions}</div>}
    </header>
    <div className="material-body">{children}</div>
  </section>
}
