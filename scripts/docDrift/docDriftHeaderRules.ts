// [INPUT] docDriftParse::parseHeader/hasAnyTag/inputRefs/outputClaims/HEADER_TAGS (POS: 文档漂移守护的文本解析层：从源码文本读出文件头、导出与标识符) ·
//         docDriftIndex::SourceIndex/DriftFinding/isDeclarationPath (POS: 文档漂移守护的数据模型与源码索引，规则层只和内存快照打交道)
// [OUTPUT] checkHeaders: 文件头（L4）与代码的三条一致性规则：段落齐全、OUTPUT 点名的导出真实存在、INPUT 点名的模块与符号真实存在
// [POS] 文档漂移守护的文件头规则。只管「写了就必须是真的」：没有任何标签的文件不在判定范围，
//       OUTPUT 没列全某个导出、INPUT 用自由写法（没有 `模块::符号` 或没有 POS）同样不判定，这些靠人审，不靠脚本猜。
import {
  HEADER_TAGS,
  hasAnyTag,
  inputRefs,
  outputClaims,
  parseHeader,
  type FileHeader
} from './docDriftParse'
import { isDeclarationPath, type DriftFinding, type SourceIndex } from './docDriftIndex'

const MODULE_FILE = /\.(?:ts|tsx|mts)$/

/** npm 依赖（含 `@scope/name` 与子路径）与 Node 内置模块：不是仓库里的文件，INPUT 可以照样点名。 */
function isExternalModule(spec: string, external: ReadonlySet<string>): boolean {
  if (spec.startsWith('node:')) return true
  const segments = spec.split('/')
  return external.has(spec.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0])
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

/** 名字或带 `*` 通配的写法是否命中某个导出。 */
function matchesExport(pattern: string, exported: ReadonlySet<string>): boolean {
  if (!pattern.includes('*')) return exported.has(pattern)
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`)
  return [...exported].some((name) => regex.test(name))
}

function checkSections(file: string, header: FileHeader): DriftFinding[] {
  const findings: DriftFinding[] = []
  const anchor = Math.min(...Object.values(header.lines))
  for (const tag of HEADER_TAGS) {
    const body = header.sections[tag]
    if (body) continue
    findings.push({
      rule: 'header-incomplete',
      file,
      line: header.lines[tag] ?? anchor,
      message: body === undefined ? `文件头缺 [${tag}]` : `文件头的 [${tag}] 是空的`
    })
  }
  return findings
}

export function checkHeaders(
  sources: ReadonlyMap<string, string>,
  index: SourceIndex,
  externalModules: ReadonlySet<string>
): DriftFinding[] {
  const findings: DriftFinding[] = []
  for (const [file, text] of sources) {
    if (!MODULE_FILE.test(file) || isDeclarationPath(file)) continue
    const header = parseHeader(text)
    if (!hasAnyTag(header)) continue

    findings.push(...checkSections(file, header))

    const exported = index.exportsOf(file)
    for (const claim of outputClaims(header.sections.OUTPUT ?? '')) {
      if (matchesExport(claim, exported)) continue
      findings.push({
        rule: 'output-not-exported',
        file,
        line: header.lines.OUTPUT ?? null,
        message: `[OUTPUT] 写了 ${claim}，但本文件没有导出它`
      })
    }

    for (const ref of inputRefs(header.sections.INPUT ?? '')) {
      const target = index.resolveModule(ref.module, file)
      // 歧义（同名模块多个且分不出最近的）无法验证，宁可放过也不猜
      if (target.kind === 'ambiguous') continue
      if (target.kind === 'missing') {
        if (isExternalModule(ref.module, externalModules)) continue
        findings.push({
          rule: 'input-module-missing',
          file,
          line: header.lines.INPUT ?? null,
          message: `[INPUT] 引用的模块 ${ref.module} 找不到对应的源码文件`
        })
        continue
      }
      const targetExports = index.exportsOf(target.path)
      for (const symbol of ref.symbols) {
        if (matchesExport(symbol, targetExports)) continue
        findings.push({
          rule: 'input-not-exported',
          file,
          line: header.lines.INPUT ?? null,
          message: `[INPUT] 点名 ${ref.module}::${symbol}，但 ${target.path} 没有导出它`
        })
      }
    }
  }
  return findings
}
