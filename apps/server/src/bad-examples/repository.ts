import type { BadExample, BadExamplePage, BadExampleQuery, BadExampleRequest } from '@agent4novel/contracts'

export interface BadExampleRepository {
  markBadExample(workId: string, request: BadExampleRequest): BadExample
  getBadExample(workId: string, id: string): BadExample | undefined
  listBadExamples(workId: string, query: BadExampleQuery): BadExamplePage
}
