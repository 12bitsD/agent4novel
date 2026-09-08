// Diagnostics are best effort and must never change a business command's outcome.
export function safeLog(value: unknown): void {
  try { console.log(JSON.stringify(value)) } catch { /* diagnostic sink unavailable */ }
}
