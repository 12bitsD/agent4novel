import { useState } from 'react'
import Bookcase from './pages/Bookcase.js'
import Entry from './pages/Entry.js'
import Workspace from './pages/Workspace.js'

type View = { name: 'bookcase' } | { name: 'entry' } | { name: 'workspace'; workId: string; chapter?: number }

function initialView(): View {
  const params = new URLSearchParams(window.location.search)
  const workId = params.get('work')
  const chapter = Number(params.get('chapter'))
  return workId ? { name: 'workspace', workId, ...(Number.isSafeInteger(chapter) && chapter > 0 ? { chapter } : {}) } : params.get('view') === 'entry' ? { name: 'entry' } : { name: 'bookcase' }
}

export default function App() {
  const [view, setView] = useState<View>(initialView)
  const navigate = (next: View) => {
    const url = new URL(window.location.href)
    url.searchParams.delete('work')
    url.searchParams.delete('view')
    url.searchParams.delete('chapter')
    if (next.name === 'workspace') url.searchParams.set('work', next.workId)
    if (next.name === 'entry') url.searchParams.set('view', 'entry')
    // The selected work and chapter are reloadable without starting generation.
    window.history.replaceState(null, '', url)
    setView(next)
  }

  if (view.name === 'entry') {
    return (
      <Entry
        onBack={() => navigate({ name: 'bookcase' })}
        onCreated={(workId) => navigate({ name: 'workspace', workId })}
      />
    )
  }
  if (view.name === 'workspace') {
    return <Workspace key={view.workId} workId={view.workId} initialChapter={view.chapter} onBack={() => navigate({ name: 'bookcase' })}
      onChapterChange={chapter => {
        const url = new URL(window.location.href)
        url.searchParams.set('chapter', String(chapter))
        window.history.replaceState(null, '', url)
      }} />
  }
  return (
    <Bookcase
      onNew={() => navigate({ name: 'entry' })}
      onOpen={(workId) => navigate({ name: 'workspace', workId })}
    />
  )
}
