import { loadLocalEnv } from './config/local-env.js'

// 先载入仓库根目录 .env.local，再动态 import 装配层，确保 provider 创建时能看到凭据。
// 测试不会 import 此入口，因此不会意外读取开发者本机 secret。
loadLocalEnv()
await import('./start.js')
