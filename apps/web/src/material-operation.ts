// A validated 4xx is a rejection; everything else after a write may have taken effect.
export function materialWriteUnconfirmed(error: unknown): boolean {
  const value = error as { status?: number; writeOutcome?: string; name?: string }
  if (value?.name === 'ZodError') return false
  if (value?.writeOutcome === 'unknown') return true
  return value?.status === undefined || value.status < 400 || value.status >= 500
}
