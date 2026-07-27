// [INPUT] none
// [OUTPUT] formatUnknownErrorForLog
// [POS] mihomo REST catch 值序列化；axios interceptor reject plain object 时避免 app-log `[object Object]`。

/** Serialize unknown catch values for appendAppLog — mihomo axios rejects plain objects. */
export function formatUnknownErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      error.cause != null ? ` cause=${formatUnknownErrorForLog(error.cause)}` : ''
    return `${error.name}: ${error.message}${cause}`
  }
  if (typeof error === 'string') {
    return error
  }
  if (error == null) {
    return String(error)
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** Human-readable message for UI toasts — unwrap mihomo `{ message: ... }` plain objects. */
export function formatUnknownErrorForUi(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim() || error.name
  }
  if (typeof error === 'string') {
    return error
  }
  if (error != null && typeof error === 'object') {
    if ('message' in error) {
      const nested = (error as { message: unknown }).message
      if (typeof nested === 'string' && nested.trim()) {
        return nested
      }
      if (nested != null && nested !== error) {
        return formatUnknownErrorForUi(nested)
      }
    }
  }
  const serialized = formatUnknownErrorForLog(error)
  return serialized === '[object Object]' ? '未知错误' : serialized
}
