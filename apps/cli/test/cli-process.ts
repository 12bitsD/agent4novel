import { fileURLToPath } from 'node:url'

export const cliBin = fileURLToPath(new URL('../bin/a4n', import.meta.url))

// Never inherit credentials or provider endpoints from the developer's environment.
// Explicit empty values also prevent the worker's local env loader from filling keys.
export function cliTestEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    A4N_MODEL: '',
    DEEPSEEK_API_KEY: '',
    DEEPSEEK_BASE_URL: 'http://127.0.0.1:1',
    LONGCAT_API_KEY: '',
    LONGCAT_BASE_URL: 'http://127.0.0.1:1',
    A4N_BASE_URL: 'http://127.0.0.1:1',
    A4N_LLM_TIMEOUT_MS: '1000',
    A4N_CLI_TIMEOUT_MS: '1000',
    ...overrides,
  }
}
