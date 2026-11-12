import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const children = [
  spawn(join(root, '.venv/bin/a4n-api'), [], { cwd: root, env: process.env, stdio: 'inherit' }),
  spawn('pnpm', ['--filter', '@agent4novel/web', 'exec', 'vite', '--port', process.env.A4N_WEB_PORT || '5173'], { cwd: root, env: process.env, stdio: 'inherit' }),
]
let stopping = false
let exitCode = 0
let deadline
for (const child of children) {
  child.once('error', error => {
    console.error(error instanceof Error ? error.message : 'Unable to start development process')
    stop(1)
  })
  child.once('exit', (code, signal) => {
    if (!stopping && (code || signal)) exitCode = code || 1
    stop(exitCode)
  })
}
function stop(code) {
  exitCode = code
  if (stopping) return
  stopping = true
  deadline = setTimeout(() => { exitCode = 1; for (const child of children) child.kill('SIGKILL') }, 10_000)
  deadline.unref()
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  const check = setInterval(() => {
    if (children.every(child => child.exitCode !== null || child.signalCode !== null)) {
      clearInterval(check)
      clearTimeout(deadline)
      process.exitCode = exitCode
    }
  }, 50)
  check.unref()
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
