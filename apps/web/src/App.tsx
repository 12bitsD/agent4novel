import { useState } from 'react'
import Bookcase from './pages/Bookcase.js'
import Entry from './pages/Entry.js'
import Workspace from './pages/Workspace.js'

type View = { name: 'bookcase' } | { name: 'entry' } | { name: 'workspace'; workId: string }

function initialView(): View {
  const params = new URLSearchParams(window.location.search)
  const workId = params.get('work')
  return workId ? { name: 'workspace', workId } : params.get('view') === 'entry' ? { name: 'entry' } : { name: 'bookcase' }
}

export default function App() {
  const [view, setView] = useState<View>(initialView)
  const navigate = (next: View) => {
    const url = new URL(window.location.href)
    url.searchParams.delete('work')
    url.searchParams.delete('view')
    if (next.name === 'workspace') url.searchParams.set('work', next.workId)
    if (next.name === 'entry') url.searchParams.set('view', 'entry')
    // Keep the current work address reloadable; multi-chapter navigation belongs to #6.
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
    return <Workspace key={view.workId} workId={view.workId} onBack={() => navigate({ name: 'bookcase' })} />
  }
  return (
    <Bookcase
      onNew={() => navigate({ name: 'entry' })}
      onOpen={(workId) => navigate({ name: 'workspace', workId })}
    />
  )
}
