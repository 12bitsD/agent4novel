import { z } from 'zod'

// Supported application controls; omitted fields are resolved by ModelRuntime.
export const generationParametersSchema = z.object({
  thinking: z.enum(['enabled', 'disabled']).optional(),
  temperature: z.number().min(0).max(1).optional(),
  topP: z.number().gt(0).max(1).optional(),
}).strict()
export type GenerationParameters = z.infer<typeof generationParametersSchema>

export const agentConfigSchema = z.object({
  ...generationParametersSchema.shape,
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  // creative 步骤直出方向个数(#3c):默认 2,严格 1~3
  directionCount: z.number().int().min(1).max(3).optional(),
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
