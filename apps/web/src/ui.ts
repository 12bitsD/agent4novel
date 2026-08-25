import type { CSSProperties } from 'react'

// 页面共享的 UI 小件：输入框/按钮样式 + 列表编辑 helper（Entry 与 Workspace 同源）

export const fieldStyle: CSSProperties = {
  width: '100%',
  padding: 8,
  borderRadius: 8,
  border: '1px solid #ddd',
  fontSize: 14,
  boxSizing: 'border-box',
}

export const smallBtnStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 13,
  cursor: 'pointer',
}

export const tabStyle = (active: boolean): CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 8,
  border: active ? '1px solid #333' : '1px solid #ddd',
  background: active ? '#333' : '#fff',
  color: active ? '#fff' : '#333',
  cursor: 'pointer',
})

export function replaceAt<T>(items: T[], index: number, next: T): T[] {
  return items.map((it, j) => (j === index ? next : it))
}

export function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, j) => j !== index)
}
