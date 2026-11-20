// [INPUT] docDriftIndex::DriftFinding (POS: 文档漂移守护的数据模型与源码索引，规则层只和内存快照打交道) ·
//         docDriftDocRules::contentLines (POS: 文档漂移守护的文档规则，核对文档点名的东西还在不在)
// [OUTPUT] numericConstants: 一个文件里的数值常量与其值 · collectConstants: 全仓库的数值常量（同名不同值记为歧义） ·
//          NumberClaim · numberClaims: 文档里「`常量名`（数值）」与「`常量名` = 数值」两种写法的声称 ·
//          checkDocNumbers: 这些声称与代码常量的值一致
// [POS] 文档漂移守护的数值规则。只判定文档把数值和常量名挂在一起的两种写法，散文里没点名常量的数字无从绑定，不判定；
//       常量值只认纯数字表达式（数字、同文件里已算出的常量、加减乘除与括号），其余不求值，也就不判定。
import { contentLines } from './docDriftDocRules'
import type { DriftFinding } from './docDriftIndex'

const CONSTANT_DECL =
  /^(?:export\s+)?const\s+([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)\s*(?::\s*number\s*)?=\s*([^\n]+?)\s*(?:as const\s*)?(?:\/\/[^\n]*)?$/gm

/** 求值：数字（可带 `_` 分隔）、已知常量名、`+ - * /` 与括号；认不出的记号整体返回 null。 */
function evaluate(expression: string, known: ReadonlyMap<string, number>): number | null {
  const tokens = expression.match(/\d[\d_]*(?:\.\d+)?|[A-Z][A-Z0-9_]*|[()+\-*/]|\S/g) ?? []
  let pos = 0

  function atom(): number | null {
    const token = tokens[pos++]
    if (token === undefined) return null
    if (token === '(') {
      const inner = sum()
      return tokens[pos++] === ')' ? inner : null
    }
    if (token === '-') {
      const operand = atom()
      return operand === null ? null : -operand
    }
    if (/^\d/.test(token)) return Number(token.replace(/_/g, ''))
    return known.get(token) ?? null
  }

  function product(): number | null {
    let value = atom()
    while (value !== null && (tokens[pos] === '*' || tokens[pos] === '/')) {
      const operator = tokens[pos++]
      const rhs = atom()
      value = rhs === null ? null : operator === '*' ? value * rhs : value / rhs
    }
    return value
  }

  function sum(): number | null {
    let value = product()
    while (value !== null && (tokens[pos] === '+' || tokens[pos] === '-')) {
      const operator = tokens[pos++]
      const rhs = product()
      value = rhs === null ? null : operator === '+' ? value + rhs : value - rhs
    }
    return value
  }

  const result = sum()
  return pos === tokens.length && result !== null && Number.isFinite(result) ? result : null
}

export function numericConstants(text: string): Map<string, number> {
  const values = new Map<string, number>()
  for (const match of text.matchAll(CONSTANT_DECL)) {
    const value = evaluate(match[2], values)
    if (value !== null) values.set(match[1], value)
  }
  return values
}

/** 同名常量在不同文件里值不同（测试夹具常各自定义 `HOUR_MS`）时记为 null：文档指的是哪个无法确定，不判定。 */
export function collectConstants(
  sources: ReadonlyMap<string, string>
): ReadonlyMap<string, number | null> {
  const all = new Map<string, number | null>()
  for (const text of sources.values()) {
    for (const [name, value] of numericConstants(text)) {
      const seen = all.get(name)
      all.set(name, seen === undefined || seen === value ? value : null)
    }
  }
  return all
}

const UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  毫秒: 1,
  s: 1000,
  秒: 1000,
  min: 60_000,
  分钟: 60_000,
  h: 3_600_000,
  小时: 3_600_000,
  天: 86_400_000
}

/** 常量名后缀决定它的单位；没有时间后缀的按个数处理。 */
const NAME_SUFFIX_MS: Readonly<Record<string, number>> = {
  MS: 1,
  SEC: 1000,
  SECONDS: 1000,
  MIN: 60_000,
  MINUTES: 60_000,
  HOUR: 3_600_000,
  HOURS: 3_600_000,
  DAY: 86_400_000,
  DAYS: 86_400_000
}

const TIME_QUANTITY = /(?<![\w./-])(\d+(?:\.\d+)?)\s*(毫秒|分钟|小时|ms|min|秒|天|s|h)(?![A-Za-z])/
const BARE_COUNT = /^\s*(?:现为|默认|=)?\s*(\d+)\s*(?:条|次|个|轮|回)?\s*$/
const CONSTANT_MENTION = /`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g

function describeMs(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} 小时`
  if (ms % 60_000 === 0) return `${ms / 60_000} 分钟`
  if (ms % 1000 === 0) return `${ms / 1000} 秒`
  return `${ms} 毫秒`
}

/**
 * 文档对一个常量声称的值：紧跟在常量名后的 `（…）` 或 `= …`。
 * 时间常量取其中第一个「数字 + 时间单位」；个数常量要求括号里恰好只有一个数。
 */
function claimedValue(tail: string, unitMs: number | null): { text: string; value: number } | null {
  const paren = /^[（(]([^）)]*)[）)]/.exec(tail)
  const equals = /^\s*=\s*(.*)$/.exec(tail)
  const content = paren?.[1] ?? equals?.[1]
  if (content === undefined) return null
  if (unitMs === null) {
    const count = paren ? BARE_COUNT.exec(content) : /^(\d+)(?![\d.])/.exec(content)
    return count ? { text: count[1], value: Number(count[1]) } : null
  }
  const quantity = (paren ? TIME_QUANTITY : new RegExp(`^${TIME_QUANTITY.source}`)).exec(content)
  return quantity
    ? { text: `${quantity[1]} ${quantity[2]}`, value: Number(quantity[1]) * UNIT_MS[quantity[2]] }
    : null
}

export interface NumberClaim {
  file: string
  line: number
  name: string
  /** 代码里的值：时间常量折成毫秒，其余按个数 */
  actual: number
  /** 文档写的值，同一口径 */
  claimed: number
  /** 文档里的原文，如 `30 分钟` */
  text: string
  isDuration: boolean
}

/** 文档里全部「常量名 + 数值」的声称（常量值求不出或有歧义的不算）。 */
export function numberClaims(
  docs: ReadonlyMap<string, string>,
  constants: ReadonlyMap<string, number | null>
): NumberClaim[] {
  const claims: NumberClaim[] = []
  for (const [file, doc] of docs) {
    for (const { text, line } of contentLines(doc)) {
      for (const mention of text.matchAll(CONSTANT_MENTION)) {
        const name = mention[1]
        const value = constants.get(name)
        if (value === undefined || value === null) continue
        const unitMs = NAME_SUFFIX_MS[name.slice(name.lastIndexOf('_') + 1)] ?? null
        const claim = claimedValue(text.slice(mention.index + mention[0].length), unitMs)
        if (!claim) continue
        claims.push({
          file,
          line,
          name,
          actual: value * (unitMs ?? 1),
          claimed: claim.value,
          text: claim.text,
          isDuration: unitMs !== null
        })
      }
    }
  }
  return claims
}

export function checkDocNumbers(
  docs: ReadonlyMap<string, string>,
  constants: ReadonlyMap<string, number | null>
): DriftFinding[] {
  return numberClaims(docs, constants)
    .filter((claim) => Math.abs(claim.actual - claim.claimed) > 1e-9 * Math.max(1, claim.actual))
    .map((claim) => ({
      rule: 'doc-number-mismatch' as const,
      file: claim.file,
      line: claim.line,
      message: `${claim.name} 在代码里是 ${claim.isDuration ? describeMs(claim.actual) : claim.actual}，文档写的是 ${claim.text}`
    }))
}
