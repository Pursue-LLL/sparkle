// [INPUT] node:assert（找不到函数时让测试以明确的原因失败）
// [OUTPUT] functionBody: 按函数名从 shell 源码里切出顶格定义的那个函数（含函数体）
// [POS] 脚本文本类测试共用：切出一个函数后，既可以对它做结构断言，也可以单独放进真实 bash 里执行。
import assert from 'node:assert/strict'

/** 取一个顶格定义的 shell 函数的完整函数体（到下一个顶格 `}` 为止）。 */
export function functionBody(text: string, name: string): string {
  const match = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm').exec(text)
  assert.ok(match, `function ${name}() not found`)
  return match[0]
}
