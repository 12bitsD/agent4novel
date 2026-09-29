import Database from 'better-sqlite3'
import { SqliteStore } from '../../src/store/sqlite-store.js'
import type { SaveArtifactInput } from '../../src/store/work-store.js'

const path = process.argv[2]
if (!path || !process.send) throw new Error('worker requires a database path and IPC')
process.send({ type: 'ready' })
process.once('message', (message: { action: string; request?: SaveArtifactInput; workId?: string }) => {
  if (message.action === 'uncommitted') {
    const db = new Database(path)
    db.exec('BEGIN IMMEDIATE')
    db.prepare('UPDATE works SET title = ? WHERE id = ?').run('uncommitted title', message.workId)
    process.send!({ type: 'uncommitted' })
    // The parent terminates this child while its transaction remains open.
    setInterval(() => {}, 1000)
    return
  }
  let store: SqliteStore | undefined
  try {
    store = new SqliteStore(path)
    if (message.action === 'seed') {
      process.send!({ type: 'result', seeded: store.createWorksIfEmpty([{ seed: 'one' }, { seed: 'two' }]) })
    } else if (message.action === 'save' && message.request) {
      const saved = store.saveArtifact(message.request)
      process.send!({ type: 'result', outcome: 'committed', version: saved.version })
    } else if (message.action === 'committed') {
      store.createWork({ seed: 'committed before kill', title: 'survives' })
      process.send!({ type: 'committed' })
      setInterval(() => {}, 1000)
      return
    } else throw new Error('unknown worker action')
  } catch (error) {
    process.send!({ type: 'result', outcome: error && typeof error === 'object' && 'code' in error ? error.code : 'unexpected-error' })
  } finally {
    if (message.action !== 'committed') store?.close()
  }
  process.disconnect()
})
