import { z } from 'zod'

export const agentConfigSchema = z.object({
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
})

export type AgentConfig = z.infer<typeof agentConfigSchema>

export const emptyAgentConfig: AgentConfig = {}

export interface Step<In = unknown, Out = unknown> {
  id: string
  inputSchema: z.ZodType<In>
  outputSchema: z.ZodType<Out>
  run(input: In, config: AgentConfig): Promise<Out>
}

export async function runStep<In, Out>(
  step: Step<In, Out>,
  input: unknown,
  config: AgentConfig,
): Promise<Out> {
  const parsed = step.inputSchema.parse(input)
  const out = await step.run(parsed, config)
  return step.outputSchema.parse(out)
}
