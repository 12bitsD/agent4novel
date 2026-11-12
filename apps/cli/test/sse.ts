import type { ServerResponse } from 'node:http'

export function writeChatCompletion(
  response: ServerResponse,
  content: unknown,
  model = 'kimi-k2.8-highspeed',
  usage = { prompt_tokens: 10, completion_tokens: 20 },
) {
  response.setHeader('Content-Type', 'text/event-stream')
  response.write(`data: ${JSON.stringify({
    id: 'mock-nextloop',
    model,
    choices: [{ index: 0, delta: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  })}\n\n`)
  response.end('data: [DONE]\n\n')
}
