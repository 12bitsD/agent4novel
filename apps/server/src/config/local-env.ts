import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const defaultEnvFile = fileURLToPath(new URL('../../../../.env.local', import.meta.url))

// 只在 server 入口调用：测试直接 import 模块时不会把本机 secret 注入测试进程。
// process env 优先（Node 的 loadEnvFile 不覆盖已存在变量），便于 CI / shell 临时覆盖。
export function loadLocalEnv(path = defaultEnvFile): boolean {
  try {
    loadEnvFile(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
