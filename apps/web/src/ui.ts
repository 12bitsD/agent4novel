import type { CSSProperties } from 'react'

// 页面共享的 UI 小件:输入框/按钮样式 + 列表编辑 helper(Entry 与 Workspace 同源)
// 颜色一律走 styles.css 的 var(--*) token,此处不出现硬编码色值

export const fieldStyle: CSSProperties = {
  width: '100%',
  padding: 8,
  borderRadius: 'var(--radius)',
  border: '1px solid var(--line)',
  background: 'var(--bg-raised)',
  fontSize: 14,
  boxSizing: 'border-box',
}

export const smallBtnStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 13,
  cursor: 'pointer',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--line)',
  background: 'var(--bg-raised)',
}

// 主行动按钮(珊瑚):开始创作 / 生成 / 选定
export const btnPrimary: CSSProperties = {
  padding: '10px 24px',
  fontSize: 15,
  cursor: 'pointer',
  borderRadius: 'var(--radius)',
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
}

// 次级按钮:与页面同底的细边框按钮
export const btnSecondary: CSSProperties = {
  padding: '10px 24px',
  fontSize: 15,
  cursor: 'pointer',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--line)',
  background: 'var(--bg-raised)',
}

export const tabStyle = (active: boolean): CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 'var(--radius)',
  border: active ? '1px solid var(--ink)' : '1px solid var(--line)',
  background: active ? 'var(--ink)' : 'var(--bg-raised)',
  color: active ? 'var(--bg)' : 'var(--ink)',
  cursor: 'pointer',
})

// 卡片底:书架卡片、海报区块共用
export const cardStyle: CSSProperties = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
}

// 多巴胺 chip:tags/payoffs 轮用强调色;color 传 'accent' | 'violet' | 'teal' | 'amber' | 'pink'
export const chipStyle = (color: 'accent' | 'violet' | 'teal' | 'amber' | 'pink'): CSSProperties => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 999,
  fontSize: 13,
  border: `1px solid var(--${color})`,
  color: `var(--${color})`,
})

export function replaceAt<T>(items: T[], index: number, next: T): T[] {
  return items.map((it, j) => (j === index ? next : it))
}

export function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, j) => j !== index)
}
