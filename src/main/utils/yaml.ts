import yaml from 'yaml'

export function parseYaml<T = unknown>(content: string): T {
  const processedContent = addYamlTagsToProxiesShortId(content)

  const result =
    yaml.parse(processedContent, {
      merge: true
    }) || {}

  return result as T
}

export function stringifyYaml(data: unknown): string {
  return yaml.stringify(data)
}

const shortIdPattern = /^(\s*short-id:\s*)([^\s#]+)(.*)$/

/** `short-id: 12345678` 改写成 `short-id: !!str 12345678`；null、已带标签、内联集合保持原样。 */
function tagShortIdLine(line: string): string {
  const match = line.match(shortIdPattern)
  if (!match) return line

  const [, prefix, value, suffix] = match
  if (
    value.toLowerCase() === 'null' ||
    value === '~' ||
    value.startsWith('!!') ||
    value.startsWith('{') ||
    value.startsWith('[')
  ) {
    return line
  }
  return `${prefix}!!str ${value}${suffix}`
}

/**
 * Reality 的 short-id 是十六进制字符串，纯数字写法（如 01234567、1e5）会被 YAML 解析成数字而失真。
 * 只处理顶层 proxies 列表里每个代理的 reality-opts.short-id，其他位置的同名键不动。
 */
function addYamlTagsToProxiesShortId(yamlContent: string): string {
  if (!yamlContent.includes('proxies:') || !yamlContent.includes('short-id:')) {
    return yamlContent
  }

  // 当前所处层级：顶层 proxies 列表 → 其中一个代理条目（`-` 所在缩进，null 表示不在条目内）
  // → 该代理的 reality-opts 块（`reality-opts:` 所在缩进，null 表示不在块内）
  let inProxies = false
  let proxyIndent: number | null = null
  let realityIndent: number | null = null

  return yamlContent
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return line

      const indent = line.length - line.trimStart().length
      const isListItem = trimmed.startsWith('-')

      // 顶层键决定是否在 proxies 列表内；与键同缩进的 `-` 仍是列表项
      if (indent === 0 && !isListItem) {
        inProxies = trimmed.startsWith('proxies:')
        proxyIndent = null
        realityIndent = null
        return line
      }
      if (!inProxies) return line

      // 不比当前条目更深的 `-` 才是新条目；更深的 `-` 是条目内部的嵌套列表（如 alpn）
      if (isListItem && (proxyIndent === null || indent <= proxyIndent)) {
        proxyIndent = indent
        realityIndent = null
        return line
      }
      if (proxyIndent === null) return line
      if (indent <= proxyIndent) {
        proxyIndent = null
        realityIndent = null
        return line
      }

      if (trimmed.startsWith('reality-opts:')) {
        realityIndent = indent
      } else if (realityIndent !== null && indent <= realityIndent) {
        realityIndent = null
      }
      return realityIndent !== null && trimmed.includes('short-id:') ? tagShortIdLine(line) : line
    })
    .join('\n')
}
