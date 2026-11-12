/**
 * 把 Error、控制器拒绝时返回的 `{ message }` 对象与其它抛出值统一成可读文本。
 * 按 `message` 字段而非 `instanceof Error` 判断：脚本沙箱等其它执行环境创建的 Error 同样能读到消息。
 * 它只用在失败路径上，因此自身不能再抛：无法转成字符串的值（如无原型对象）退回类型标签。
 */
export function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { message } = error as { message?: unknown }
    if (typeof message === 'string') {
      return message
    }
  }
  try {
    return String(error)
  } catch {
    return Object.prototype.toString.call(error)
  }
}
