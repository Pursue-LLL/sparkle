// [INPUT] 订阅下载得到的文本 · utils/yaml::parseYaml (POS: YAML 解析与序列化)
// [OUTPUT] InvalidProfileContentError · assertValidProfileContent
// [POS] 远程订阅写盘前的唯一内容校验：错误页、限流提示、JSON 错误体、空响应、不含任何配置段的内容都不是配置，
// 拒绝后旧文件原样保留，由更新编排按退避重试；写进去的坏内容会让依赖它的合并订阅无法重建、
// 直接使用它的订阅没有节点，而且服务端当时返回了什么再也查不到——错误信息因此带上内容开头（凭证值已脱敏）。

import { parseYaml } from '../utils/yaml'

/** 订阅内容通不过校验：区别于网络错误，每次重试都是一次真实请求，需要退避。 */
export class InvalidProfileContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidProfileContentError'
  }
}

/** 写进错误信息的内容开头：够认出错误页或限流提示，又不会把整份内容抄进日志。 */
const PREVIEW_MAX_CHARS = 80

/** 开头里碰巧带着节点定义或回显的令牌时，凭证的值不能原样落进日志。 */
const CREDENTIAL_VALUE =
  /\b(password|passwd|psk|uuid|private-key|auth-str|token|secret)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}\]]+)/gi

function preview(content: string): string {
  const flattened = content.trim().replace(/\s+/g, ' ').replace(CREDENTIAL_VALUE, '$1$2***')
  return flattened.length > PREVIEW_MAX_CHARS
    ? `${flattened.slice(0, PREVIEW_MAX_CHARS)}…`
    : flattened
}

function invalid(label: string, reason: string): InvalidProfileContentError {
  return new InvalidProfileContentError(`订阅内容不是有效的配置：${label}（${reason}）`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 订阅文件承担职责的几段：节点（直接写出或由 provider 提供）、分组与规则。
 * 只带分组与规则的模板（节点由覆写补）也是合法订阅，所以不强求有节点；
 * 但错误页、限流提示、JSON 错误体与空文档里一段都没有。
 */
const CONFIG_SECTIONS = [
  'proxies',
  'proxy-providers',
  'proxy-groups',
  'rules',
  'rule-providers'
] as const

function hasConfigContent(document: Record<string, unknown>): boolean {
  return CONFIG_SECTIONS.some((key) => {
    const section = document[key]
    return Array.isArray(section)
      ? section.length > 0
      : isPlainObject(section) && Object.keys(section).length > 0
  })
}

/** 内容必须是含配置段的 YAML 映射，否则抛 {@link InvalidProfileContentError}。 */
export function assertValidProfileContent(content: string, label: string): void {
  if (content.trim() === '') {
    throw invalid(label, '内容为空')
  }

  let document: unknown
  try {
    document = parseYaml(content)
  } catch (error) {
    const syntax = (error instanceof Error ? error.message : String(error)).split('\n')[0]
    throw invalid(label, `YAML 语法错误：${syntax}；开头：「${preview(content)}」`)
  }

  if (!isPlainObject(document)) {
    throw invalid(label, `不是配置文件，开头：「${preview(content)}」`)
  }
  if (!hasConfigContent(document)) {
    throw invalid(label, `没有非空的 ${CONFIG_SECTIONS.join(' / ')}`)
  }
}
