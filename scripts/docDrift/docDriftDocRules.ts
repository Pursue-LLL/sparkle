// [INPUT] docDriftIndex::RepoSnapshot/DriftFinding/dirOf/joinRelative/isCodePath/isTestPath/isDeclarationPath/isFixturePath (POS: 文档漂移守护的数据模型与源码索引，规则层只和内存快照打交道)
// [OUTPUT] checkDocs: 文档（L1 `ARCHITECTURE.md`、L3 `_ARCH.md`）与代码的一致性规则：反引号里的文件名与标识符真实存在、
//          相对链接可达、每份 `_ARCH.md` 都挂在 `ARCHITECTURE.md` 的模块导航里、`_ARCH.md` 列全了本目录的源码文件 ·
//          EXTERNAL_NAMES: 文档里合法出现、但不在本仓库代码里的外部名字 · contentLines: 去掉围栏代码块的文档行
// [POS] 文档漂移守护的文档规则。核对的是「文档点名的东西还在不在」与「新增文件有没有登记」，不核对散文的含义；
//       标识符只认 UPPER_SNAKE 与驼峰写法（`use`、`Map` 这类普通词不查），存在与否按「代码里是否出现过这个词」判定。
import {
  dirOf,
  isCodePath,
  isDeclarationPath,
  isFixturePath,
  isTestPath,
  joinRelative,
  type DriftFinding,
  type RepoSnapshot
} from './docDriftIndex'

/**
 * 文档里合法出现、但不在本仓库代码里的外部名字（改成别的说法或新增外部名字都在这里登记）：
 * Chromium 的单实例锁文件、Google Cloud Code 的接口方法、Node 的环境变量。
 */
export const EXTERNAL_NAMES: ReadonlySet<string> = new Set([
  'SingletonLock',
  'loadCodeAssist',
  'fetchAvailableModels',
  'NODE_OPTIONS'
])

const FILE_SPAN =
  /^((?:\.{1,2}\/)*[\w@][\w@./-]*\.(?:ts|tsx|mts|cts|mjs|cjs|sh))(?::\d+(?:-\d+)?)?$/
const IDENTIFIER_SPAN = /^([A-Za-z_$][\w$]*)(?:\(\))?$/
const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/
const CAMEL_CASE = /[a-z][A-Z]/

export interface DocLine {
  text: string
  /** 从 1 起 */
  line: number
}

/** 文档逐行内容，跳过围栏代码块（里面的反引号与链接不是文档在断言什么）。 */
export function contentLines(doc: string): DocLine[] {
  const lines: DocLine[] = []
  let inFence = false
  doc.split(/\r?\n/).forEach((text, i) => {
    if (/^\s*```/.test(text)) inFence = !inFence
    else if (!inFence) lines.push({ text, line: i + 1 })
  })
  return lines
}

function looksLikeSymbol(name: string): boolean {
  return UPPER_SNAKE.test(name) || CAMEL_CASE.test(name)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
}

function allDirs(paths: ReadonlySet<string>): Set<string> {
  const dirs = new Set<string>()
  for (const path of paths) {
    for (let dir = dirOf(path); dir !== '' && !dirs.has(dir); dir = dirOf(dir)) dirs.add(dir)
  }
  return dirs
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

interface DocContext {
  snapshot: RepoSnapshot
  words: ReadonlySet<string>
  baseNames: ReadonlySet<string>
  dirs: ReadonlySet<string>
}

/** 带目录的写法按「整条路径」或「路径后缀」找；只写文件名的按文件名找；`@别名/` 前缀先去掉。 */
function sourceFileExists(token: string, docDir: string, ctx: DocContext): boolean {
  if (token.startsWith('/')) return true
  const clean = token.replace(/^@[\w-]+\//, '').replace(/^\.\//, '')
  if (!clean.includes('/')) return ctx.baseNames.has(clean)
  const fromDoc = joinRelative(docDir, clean)
  if (ctx.snapshot.paths.has(clean) || (fromDoc !== null && ctx.snapshot.paths.has(fromDoc))) {
    return true
  }
  for (const path of ctx.snapshot.paths) if (path.endsWith(`/${clean}`)) return true
  return false
}

function checkSpans(docPath: string, doc: string, ctx: DocContext): DriftFinding[] {
  const findings: DriftFinding[] = []
  const docDir = dirOf(docPath)
  for (const { text, line } of contentLines(doc)) {
    for (const match of text.matchAll(/`([^`]+)`/g)) {
      const span = match[1].trim()
      const file = FILE_SPAN.exec(span)
      if (file) {
        if (!sourceFileExists(file[1], docDir, ctx)) {
          findings.push({
            rule: 'doc-file-missing',
            file: docPath,
            line,
            message: `文档提到源码文件 ${file[1]}，仓库里没有这个文件`
          })
        }
        continue
      }
      const name = IDENTIFIER_SPAN.exec(span)?.[1]
      if (!name || !looksLikeSymbol(name) || EXTERNAL_NAMES.has(name) || ctx.words.has(name))
        continue
      findings.push({
        rule: 'doc-identifier-missing',
        file: docPath,
        line,
        message: `文档提到标识符 ${name}，代码里没有这个名字（改名或删除后文档没跟上；外部名字登记到 EXTERNAL_NAMES）`
      })
    }
  }
  return findings
}

/** 文档里相对路径链接的目标（已折成仓库路径）；URL、纯锚点、绝对路径不算。 */
function linkTargets(docPath: string, doc: string): Array<{ path: string; line: number }> {
  const targets: Array<{ path: string; line: number }> = []
  for (const { text, line } of contentLines(doc)) {
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const raw = match[1].split(/[#?]/, 1)[0]
      if (raw === '' || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(raw)) continue
      const path = joinRelative(dirOf(docPath), raw)
      if (path !== null) targets.push({ path, line })
    }
  }
  return targets
}

function checkLinks(docPath: string, doc: string, ctx: DocContext): DriftFinding[] {
  return linkTargets(docPath, doc)
    .filter(({ path }) => !ctx.snapshot.paths.has(path) && !ctx.dirs.has(path))
    .map(({ path, line }) => ({
      rule: 'doc-link-broken' as const,
      file: docPath,
      line,
      message: `链接指向 ${path}，仓库里没有这个文件或目录`
    }))
}

const ROOT_DOC = 'ARCHITECTURE.md'

/** `ARCHITECTURE.md` 是 L1：模块导航必须能走到每一份 `_ARCH.md`。 */
function checkNavigation(snapshot: RepoSnapshot): DriftFinding[] {
  const root = snapshot.docs.get(ROOT_DOC)
  if (root === undefined) return []
  const linked = new Set(linkTargets(ROOT_DOC, root).map(({ path }) => path))
  return [...snapshot.docs.keys()]
    .filter((path) => path.endsWith('/_ARCH.md') && !linked.has(path))
    .map((path) => ({
      rule: 'arch-not-linked' as const,
      file: ROOT_DOC,
      line: null,
      message: `模块导航没有链到 ${path}`
    }))
}

/** 新增文件要登记进所在目录的 `_ARCH.md`（只看该目录的直接子文件）。 */
function checkListing(snapshot: RepoSnapshot): DriftFinding[] {
  const findings: DriftFinding[] = []
  for (const [docPath, doc] of snapshot.docs) {
    if (!docPath.endsWith('/_ARCH.md')) continue
    const dir = dirOf(docPath)
    for (const path of snapshot.sources.keys()) {
      if (dirOf(path) !== dir || !isCodePath(path)) continue
      if (isTestPath(path) || isDeclarationPath(path) || isFixturePath(path)) continue
      const base = basenameOf(path)
      // 前面不能是字母数字、点、连字符（`xfoo.ts`、`a.foo.ts` 不算提到 `foo.ts`），路径分隔符可以
      if (new RegExp(`(?<![\\w.-])${escapeRegExp(base)}(?![\\w-])`).test(doc)) continue
      findings.push({
        rule: 'arch-file-unlisted',
        file: docPath,
        line: null,
        message: `${base} 在本目录里，但 _ARCH.md 没有登记它`
      })
    }
  }
  return findings
}

export function checkDocs(snapshot: RepoSnapshot, words: ReadonlySet<string>): DriftFinding[] {
  const ctx: DocContext = {
    snapshot,
    words,
    baseNames: new Set([...snapshot.paths].map(basenameOf)),
    dirs: allDirs(snapshot.paths)
  }
  const findings: DriftFinding[] = []
  for (const [docPath, doc] of snapshot.docs) {
    findings.push(...checkSpans(docPath, doc, ctx), ...checkLinks(docPath, doc, ctx))
  }
  findings.push(...checkNavigation(snapshot), ...checkListing(snapshot))
  return findings
}
