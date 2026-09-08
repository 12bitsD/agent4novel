export async function withDeadline<T>(ms: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error('请求超时，结果尚未确认')); controller.abort() }, ms)
  })
  try { return await Promise.race([task(controller.signal), deadline]) }
  finally { clearTimeout(timer) }
}
