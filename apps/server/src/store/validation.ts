import type { z } from 'zod'

export class StoreContractError extends Error {
  constructor(readonly code: 'invalid-store-input' | 'invalid-stored-data') {
    super(code === 'invalid-stored-data' ? 'stored data violates its contract' : 'store input violates its contract')
    this.name = 'StoreContractError'
  }
}

// The safe error deliberately excludes schema diagnostics and author content.
export function validateStoreValue<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, source: 'input' | 'stored'): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new StoreContractError(source === 'stored' ? 'invalid-stored-data' : 'invalid-store-input')
  return parsed.data
}
