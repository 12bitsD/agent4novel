import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { seed } from './seed.js'
import { InMemoryStore } from './store/in-memory-store.js'

const store = new InMemoryStore()
seed(store)

serve({ fetch: createApp(store).fetch, port: 8787 }, (info) => {
  console.log(`agent4novel server listening on http://localhost:${info.port}`)
})
