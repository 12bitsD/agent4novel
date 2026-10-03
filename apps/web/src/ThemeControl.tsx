import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'
const storageKey = 'a4n-theme'
function readTheme(): Theme {
  try {
    const value = localStorage.getItem(storageKey)
    if (value === 'light' || value === 'dark') return value
  } catch { /* Browser preferences are optional; editing remains available. */ }
  return 'system'
}

export default function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.dataset.theme = theme
    try { localStorage.setItem(storageKey, theme) } catch { /* Keep the in-page choice. */ }
  }, [theme])
  return <label className="theme-control"><span>界面</span>
    <select aria-label="界面主题" value={theme} onChange={event => setTheme(event.target.value as Theme)}>
      <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
    </select>
  </label>
}
