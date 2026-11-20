// [INPUT] 无（纯文本解析：不读文件、不依赖其他模块）
// [OUTPUT] HEADER_TAGS · HeaderTag · FileHeader · parseHeader: 文件头三段正文与所在行 · hasAnyTag ·
//          splitTopLevel: 按括号外的 `·` 切条目 · InputRef · inputRefs: INPUT 里 `模块::符号 (POS: …)` 写法的引用 ·
//          outputClaims: OUTPUT 里点名的导出 · ExportInfo · exportsOf: 文件真实导出（含 `export *` 转发） ·
//          isIdentifier · collectWords: 收集代码里出现过的标识符
// [POS] 文档漂移守护的文本解析层：从源码文本读出文件头、导出与标识符，规则层据此判定文档与代码是否一致。
//       只做正则级解析，不引入 TypeScript 编译器，守护因此可以随每次测试运行。

export const HEADER_TAGS = ['INPUT', 'OUTPUT', 'POS'] as const
export type HeaderTag = (typeof HEADER_TAGS)[number]

export interface FileHeader {
  /** 每个标签的正文（空白折叠成单个空格）；文件头没写该标签则没有这个键 */
  sections: Partial<Record<HeaderTag, string>>
  /** 每个标签所在的行（从 1 起），用于报错定位 */
  lines: Partial<Record<HeaderTag, number>>
}

/** 文件头在开头几十行里；扫描有上限，免得把正文里的注释当成文件头。 */
const HEADER_SCAN_LINES = 60
const TAG_LINE = /^\[(INPUT|OUTPUT|POS)\]\s*(.*)$/

/**
 * 注释行去掉 `//`、`/**`、` * ` 之类的记号后的正文；不是注释行返回 null。
 * 整行先 `trim`，CRLF 行尾的 `\r` 因此不会混进正文。
 */
function commentBody(line: string): string | null {
  const trimmed = line.trim()
  if (trimmed.startsWith('//')) return trimmed.replace(/^\/\/+\s?/, '')
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    return trimmed.replace(/^\/?\*+\/?\s?/, '').replace(/\s*\*+\/$/, '')
  }
  return null
}

export function parseHeader(text: string): FileHeader {
  const collected: Partial<Record<HeaderTag, string[]>> = {}
  const lines: FileHeader['lines'] = {}
  let current: HeaderTag | null = null
  text.split('\n', HEADER_SCAN_LINES).forEach((line, index) => {
    const body = commentBody(line)
    if (body === null) {
      // 代码行终结当前段落；空行不终结（块注释里的空行不一定带星号）
      if (line.trim() !== '') current = null
      return
    }
    const tag = TAG_LINE.exec(body)
    if (tag) {
      const name = tag[1] as HeaderTag
      // 同一个标签以第一次出现为准：后面的（比如正文里示范文件头的注释）不覆盖真正的文件头
      current = name in collected ? null : name
      if (current) {
        collected[current] = [tag[2]]
        lines[current] = index + 1
      }
    } else if (current) {
      collected[current]?.push(body)
    }
  })
  const sections: FileHeader['sections'] = {}
  for (const tag of HEADER_TAGS) {
    const parts = collected[tag]
    if (parts) sections[tag] = parts.join(' ').replace(/\s+/g, ' ').trim()
  }
  return { sections, lines }
}

export function hasAnyTag(header: FileHeader): boolean {
  return HEADER_TAGS.some((tag) => tag in header.sections)
}

/** 按括号（半角、全角）外的分隔符切条目；括号里的 `·`（比如 POS 说明）不切。 */
export function splitTopLevel(text: string, separator = '·'): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '（') depth++
    else if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1)
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

export function isIdentifier(token: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(token)
}

/** 标识符，或带 `*` 通配的标识符（如 `AGY_DIAL_STORM_*`）。 */
function isNamePattern(token: string): boolean {
  return /^[A-Za-z_$*][\w$*]*$/.test(token) && /[A-Za-z_$]/.test(token)
}

/** 条目里以 `/`、`,`、`、` 并列的名字；末尾的 `…` 表示「等等」，不是名字。全部是名字才算，否则整段当说明文字。 */
function namesOf(text: string): string[] | null {
  const parts = text
    .replace(/[`…]|\.\.\./g, '')
    .split(/[/,，、]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  return parts.length > 0 && parts.every(isNamePattern) ? parts : null
}

export interface InputRef {
  /** `::` 左边的模块写法，原样保留 */
  module: string
  /** `::` 右边点名的符号（可含 `*` 通配） */
  symbols: string[]
}

const INPUT_REF_HEAD = /^([^\s:()（）]+)::([^()（）]*?)\s*[（(]\s*POS\s*[:：]/

/** 只认规范写法 `模块::符号 (POS: …)`；没有 `::` 或没有 POS 的自由写法不在判定范围内。 */
export function inputRefs(input: string): InputRef[] {
  const refs: InputRef[] = []
  for (const entry of splitTopLevel(input)) {
    const head = INPUT_REF_HEAD.exec(entry)
    if (!head) continue
    const symbols = namesOf(head[2])
    if (symbols) refs.push({ module: head[1], symbols })
  }
  return refs
}

/** OUTPUT 里点名的导出：每条取冒号前、括号外的部分，全是名字才算；其余是说明文字，不判定。 */
export function outputClaims(output: string): string[] {
  const claims: string[] = []
  for (const entry of splitTopLevel(output)) {
    const head = entry.replace(/[（(][^）)]*[）)]/g, '').split(/[:：]/, 1)[0]
    claims.push(...(namesOf(head) ?? []))
  }
  return claims
}

const WORD = /[A-Za-z_$][\w$]*/g

export interface ExportInfo {
  names: Set<string>
  /** `export * from 'x'` 转发的模块写法，导出要继续追进去 */
  starFrom: string[]
}

const DECL_KEYWORDS =
  '(?:const\\s+enum|function\\*?|class|const|let|var|type|interface|enum|namespace)\\s+([A-Za-z_$][\\w$]*)'
const EXPORT_DECL = new RegExp(
  `^export\\s+(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?${DECL_KEYWORDS}`,
  'gm'
)
/** `.d.ts` 里没有 `export` 的顶层声明是全局的，别的文件不用 import 就能用，等同导出。 */
const AMBIENT_DECL = new RegExp(`^(?:declare\\s+)?(?:abstract\\s+)?${DECL_KEYWORDS}`, 'gm')
const EXPORT_LIST = /^export\s+(?:type\s+)?\{([^}]*)\}/gm
const EXPORT_STAR =
  /^export\s+(?:type\s+)?\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*['"]([^'"]+)['"]/gm
/** `export default Name`、`export default React.memo(Name)`：表达式里出现的名字都算默认导出的组成。 */
const EXPORT_DEFAULT_EXPRESSION =
  /^export\s+default\s+(?!(?:async|abstract|function|class)\b)(.+)$/gm

export function exportsOf(text: string, ambient = false): ExportInfo {
  const names = new Set<string>()
  const starFrom: string[] = []
  for (const match of text.matchAll(EXPORT_DECL)) names.add(match[1])
  if (ambient) for (const match of text.matchAll(AMBIENT_DECL)) names.add(match[1])
  for (const match of text.matchAll(EXPORT_DEFAULT_EXPRESSION)) {
    for (const word of match[1].match(WORD) ?? []) names.add(word)
  }
  for (const match of text.matchAll(EXPORT_LIST)) {
    for (const item of match[1].split(',')) {
      const name = item
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
      if (name) names.add(name)
    }
  }
  for (const match of text.matchAll(EXPORT_STAR)) {
    if (match[1]) names.add(match[1])
    else starFrom.push(match[2])
  }
  return { names, starFrom }
}

export function collectWords(text: string, into: Set<string>): void {
  for (const word of text.match(WORD) ?? []) into.add(word)
}
