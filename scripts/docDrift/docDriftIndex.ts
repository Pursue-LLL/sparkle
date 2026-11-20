// [INPUT] docDriftParse::exportsOf (POS: 文档漂移守护的文本解析层：从源码文本读出文件头、导出与标识符)
// [OUTPUT] DriftRule · DriftFinding: 一条漂移（规则、文件、行、说明） · RepoSnapshot: 仓库的内存快照 ·
//          ModuleResolution · SourceIndex · createSourceIndex: 把文档里的模块写法解析成源码文件，并给出文件的完整导出集合 ·
//          isCodePath · isTestPath · isDeclarationPath · isFixturePath · dirOf · joinRelative: 路径分类、取目录、相对路径折叠
// [POS] 文档漂移守护的数据模型与源码索引：规则层只和内存快照打交道（不读磁盘），所以每条规则都能用几行字符串单测。
//       模块解析按「模块写法的后缀」匹配源码路径，同名多个时取离引用方最近的一个，仍分不出才报歧义。
import { exportsOf as parseExports } from './docDriftParse'

export type DriftRule =
  | 'header-incomplete'
  | 'output-not-exported'
  | 'input-module-missing'
  | 'input-not-exported'
  | 'arch-file-unlisted'
  | 'arch-not-linked'
  | 'doc-file-missing'
  | 'doc-identifier-missing'
  | 'doc-link-broken'
  | 'doc-number-mismatch'

export interface DriftFinding {
  rule: DriftRule
  /** 相对仓库根的 posix 路径 */
  file: string
  /** 从 1 起；定位不到具体行时为 null */
  line: number | null
  message: string
}

export interface RepoSnapshot {
  /** 仓库内全部文件（任意类型）的相对路径；文档里的文件名与链接据此判存在 */
  paths: ReadonlySet<string>
  /** 源码与脚本的文本，键是相对路径 */
  sources: ReadonlyMap<string, string>
  /** 参与核对的文档：根 `ARCHITECTURE.md` 与各目录的 `_ARCH.md` */
  docs: ReadonlyMap<string, string>
  /** 不在仓库里的模块名：npm 依赖与 Node 内置模块；文件头 INPUT 可以点名它们 */
  externalModules: ReadonlySet<string>
}

const MODULE_SUFFIXES = ['.ts', '.tsx', '.mts'] as const

export function isCodePath(path: string): boolean {
  return /\.(?:ts|tsx|mts|cts|mjs|cjs|sh)$/.test(path)
}

export function isTestPath(path: string): boolean {
  return /\.test\.(?:ts|tsx|mts)$/.test(path)
}

export function isDeclarationPath(path: string): boolean {
  return path.endsWith('.d.ts')
}

/** 测试夹具（`*Rig`、`*Harness`、`*World`）：只被测试引用，`_ARCH.md` 的「测试」一节按命名约定统一说明，不逐个登记。 */
export function isFixturePath(path: string): boolean {
  return /(?:Rig|Harness|World)\.(?:ts|tsx|mts)$/.test(path)
}

export function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

export type ModuleResolution =
  | { kind: 'found'; path: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; candidates: string[] }

export interface SourceIndex {
  /** `spec` 是文件头里 `模块::符号` 的模块写法，或 `export * from` 的相对路径 */
  resolveModule(spec: string, fromFile: string): ModuleResolution
  /** 文件的全部导出名，含 `export *` 追进去的；文件不存在得到空集合 */
  exportsOf(path: string): ReadonlySet<string>
}

function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.replace(/\.[^.]+$/, '')
}

/** 把相对写法 `./a`、`../b/c` 按所在目录折成仓库路径；折出仓库根之外返回 null。 */
export function joinRelative(dir: string, spec: string): string | null {
  const parts = dir === '' ? [] : dir.split('/')
  for (const segment of spec.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.join('/')
}

function sharedPrefixLength(a: string, b: string): number {
  const left = a.split('/')
  const right = b.split('/')
  let n = 0
  while (n < left.length && n < right.length && left[n] === right[n]) n++
  return n
}

export function createSourceIndex(sources: ReadonlyMap<string, string>): SourceIndex {
  const byStem = new Map<string, string[]>()
  for (const path of sources.keys()) {
    if (!MODULE_SUFFIXES.some((suffix) => path.endsWith(suffix))) continue
    const stem = stemOf(path)
    byStem.set(stem, [...(byStem.get(stem) ?? []), path])
  }

  /** 候选路径的全部「模块文件」形态：`base.ts` / `base.tsx` / `base/index.ts` ... */
  function matchesBase(path: string, base: string, exact: boolean): boolean {
    return MODULE_SUFFIXES.some((suffix) => {
      const direct = base + suffix
      const viaIndex = `${base}/index${suffix}`
      return exact
        ? path === direct || path === viaIndex
        : path === direct ||
            path.endsWith(`/${direct}`) ||
            path === viaIndex ||
            path.endsWith(`/${viaIndex}`)
    })
  }

  function resolveModule(spec: string, fromFile: string): ModuleResolution {
    const relative = spec.startsWith('./') || spec.startsWith('../')
    const cleaned = spec.replace(/^@[\w-]+\//, '').replace(/\.(?:ts|tsx|mts)$/, '')
    const base = relative ? joinRelative(dirOf(fromFile), cleaned) : cleaned.replace(/^\.\//, '')
    if (base === null || base === '') return { kind: 'missing' }
    const exact = relative || base.startsWith('src/') || base.startsWith('scripts/')
    const lastSegment = base.slice(base.lastIndexOf('/') + 1)
    const pool = new Set([...(byStem.get(lastSegment) ?? []), ...(byStem.get('index') ?? [])])
    const candidates = [...pool].filter((path) => matchesBase(path, base, exact))
    if (candidates.length === 0) return { kind: 'missing' }
    if (candidates.length === 1) return { kind: 'found', path: candidates[0] }
    const ranked = candidates
      .map((path) => ({ path, near: sharedPrefixLength(dirOf(path), dirOf(fromFile)) }))
      .sort((a, b) => b.near - a.near)
    return ranked[0].near > ranked[1].near
      ? { kind: 'found', path: ranked[0].path }
      : { kind: 'ambiguous', candidates: candidates.sort() }
  }

  const exportCache = new Map<string, ReadonlySet<string>>()
  const visiting = new Set<string>()

  function exportsOf(path: string): ReadonlySet<string> {
    const cached = exportCache.get(path)
    if (cached) return cached
    const text = sources.get(path)
    // 转发环里回到正在展开的文件：这一路不再贡献新名字
    if (text === undefined || visiting.has(path)) return new Set()
    visiting.add(path)
    const info = parseExports(text, isDeclarationPath(path))
    const names = new Set(info.names)
    for (const spec of info.starFrom) {
      const target = resolveModule(spec, path)
      if (target.kind === 'found') for (const name of exportsOf(target.path)) names.add(name)
    }
    visiting.delete(path)
    exportCache.set(path, names)
    return names
  }

  return { resolveModule, exportsOf }
}
