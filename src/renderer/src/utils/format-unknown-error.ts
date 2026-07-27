/** Unwrap mihomo / IPC plain-object errors for UI toasts (avoid `[object Object]`). */
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
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') {
        return serialized
      }
    } catch {
      // fall through
    }
  }
  if (error == null) {
    return '未知错误'
  }
  const fallback = String(error)
  return fallback === '[object Object]' ? '未知错误' : fallback
}
