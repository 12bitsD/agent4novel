import { useState } from 'react'
import Bookcase from './pages/Bookcase.js'
import Entry from './pages/Entry.js'
import Workspace from './pages/Workspace.js'

type View = { name: 'bookcase' } | { name: 'entry' } | { name: 'workspace'; workId: string }

export default function App() {
  const [view, setView] = useState<View>({ name: 'bookcase' })

  if (view.name === 'entry') {
    return (
      <Entry
        onBack={() => setView({ name: 'bookcase' })}
        onCreated={(workId) => setView({ name: 'workspace', workId })}
      />
    )
  }
  if (view.name === 'workspace') {
    return <Workspace key={view.workId} workId={view.workId} onBack={() => setView({ name: 'bookcase' })} />
  }
  return (
    <Bookcase
      onNew={() => setView({ name: 'entry' })}
      onOpen={(workId) => setView({ name: 'workspace', workId })}
    />
  )
}
