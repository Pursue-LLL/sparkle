/** 把 Error、控制器拒绝时返回的 `{ message }` 对象与其它抛出值统一成可读文本。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error !== null) {
    const { message } = error as { message?: unknown }
    if (typeof message === 'string') {
      return message
    }
  }
  return String(error)
}
