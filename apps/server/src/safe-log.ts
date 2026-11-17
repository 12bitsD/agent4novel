// Diagnostics are best effort and must never change a business command's
// outcome.
export function safeLog(value: unknown): void {
  try {
    // log：写入当前结果。
    // stringify：序列化数据。
    console.log(JSON.stringify(value));
  } catch (error) {
    void error;
  }
}
