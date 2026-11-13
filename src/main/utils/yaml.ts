// [INPUT] 无本地依赖
// [OUTPUT] parseYaml · stringifyYaml: YAML 解析与序列化
// [POS] YAML 读写的统一入口：解析在文档树上还原 Reality `short-id` 的原文（块 / flow / 锚点 / 合并键写法一致），纯数字写法不会丢前导零，也不会变成数字或 Infinity。

import yaml, { type Document, type Scalar } from 'yaml'

const REALITY_OPTS_KEY = 'reality-opts'
const SHORT_ID_KEY = 'short-id'

export function parseYaml<T = unknown>(content: string): T {
  // 流程与 yaml.parse 相同（警告照常上报、抛出第一个错误），只是在转成 JS 对象前多一步还原 short-id 原文
  const doc = yaml.parseDocument(content, { merge: true })
  doc.warnings.forEach((warning) => process.emitWarning(warning))
  if (doc.errors.length > 0) throw doc.errors[0]

  restoreRealityShortIdText(doc)
  return (doc.toJS() || {}) as T
}

export function stringifyYaml(data: unknown): string {
  return yaml.stringify(data)
}

const isScalarWithValue = (node: unknown, value: unknown): boolean =>
  yaml.isScalar(node) && node.value === value

/** 解析器给解析出来的每个标量都记下了原文（`source`），代码里新建的标量没有。 */
function isParsedScalar(node: unknown): node is Scalar.Parsed {
  return yaml.isScalar(node) && typeof node.source === 'string'
}

/**
 * Reality 的 short-id 是十六进制字符串，纯数字写法（01234567、1e5、12e3456）会被 YAML 解析成数字：
 * 前导零丢失、科学计数法变成 Infinity，而服务端要求逐字相同。reality-opts 里的 short-id 还原成原文，
 * 不论代理写成块风格还是 flow 风格，也不论 reality-opts 本身是否被锚点 / 合并键引用（还原发生在它定义的位置）。
 * 显式标签（如 `!!int`）是写的人的明确意图，null 表示没填，都保持原样；
 * short-id 自己是别名引用（`short-id: *x`）时没有可还原的原文，按 YAML 规则解析。
 */
function restoreRealityShortIdText(doc: Document): void {
  yaml.visit(doc, {
    Pair(_key, pair) {
      if (!isScalarWithValue(pair.key, REALITY_OPTS_KEY) || !yaml.isMap(pair.value)) return
      const shortId = pair.value.get(SHORT_ID_KEY, true)
      if (!isParsedScalar(shortId) || shortId.tag !== undefined) return
      if (shortId.value === null || typeof shortId.value === 'string') return
      shortId.value = shortId.source
    }
  })
}
