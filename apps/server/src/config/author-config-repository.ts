import type { AgentFile, AuthorConfigReceipt, AuthorConfigSave } from '@agent4novel/contracts'

// Text remains in immutable managed files, never in these database records.
export interface AuthorConfigRepository {
  getAuthorConfig(workId: string): AuthorConfigReceipt | undefined
  getAuthorConfigReceipt(workId: string, requestId: string): AuthorConfigReceipt | undefined
  saveAuthorConfig(workId: string, request: AuthorConfigSave): AuthorConfigReceipt
  listAgentFiles(workId: string): AgentFile[]
  putAgentFile(file: AgentFile): AgentFile
}
