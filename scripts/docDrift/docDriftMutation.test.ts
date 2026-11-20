// [INPUT] docDriftRepo::loadRepoSnapshot (POS: 文档漂移守护的磁盘装载层，守护里唯一碰文件系统的一环) ·
//         docDriftCore::checkDocDrift/formatFindings (POS: 文档漂移守护的入口，一次判完文件头、_ARCH.md、ARCHITECTURE.md 与代码是否一致) ·
//         docDriftIndex::createSourceIndex/dirOf/isCodePath/isTestPath/isDeclarationPath/isFixturePath/DriftFinding/DriftRule (POS: 文档漂移守护的数据模型与源码索引，规则层只和内存快照打交道) ·
//         docDriftParse::parseHeader/inputRefs/exportsOf (POS: 文档漂移守护的文本解析层，从源码文本读出文件头、导出与标识符) ·
//         docDriftDocRules::contentLines (POS: 文档漂移守护的文档规则，核对文档点名的东西还在不在)
// [OUTPUT] （无导出，仅测试）
// [POS] 守护的灵敏度验证：在真实仓库快照的内存副本上做改名、造谎、删文件、删登记、写错数值等变异，
//       每一种都必须被守护抓出来，所以装载层出错或规则被改松时这里先红，守护不会悄悄失效。变异只在内存里，不碰磁盘。
import assert from 'node:assert/strict'
import path from 'node:path'
import { before, describe, it } from 'node:test'
import { checkDocDrift, formatFindings } from './docDriftCore'
import { contentLines } from './docDriftDocRules'
import {
  createSourceIndex,
  dirOf,
  isCodePath,
  isDeclarationPath,
  isFixturePath,
  isTestPath,
  type DriftFinding,
  type DriftRule
} from './docDriftIndex'
import { exportsOf, inputRefs, parseHeader } from './docDriftParse'
import { loadRepoSnapshot } from './docDriftRepo'

const ROOT = path.resolve(import.meta.dirname, '../..')
const ROOT_DOC = 'ARCHITECTURE.md'
const MODULE_FILE = /\.(?:ts|tsx|mts)$/

interface State {
  sources: Map<string, string>
  docs: Map<string, string>
  paths: Set<string>
  /** 已被某个变异动过、或某个变异的预期要靠它存在的文件：后面的变异不再选它，免得互相抵消 */
  touched: Set<string>
}

/** 变异之后守护必须报出的一条漂移：规则、所在文件、消息里必须出现的字样。 */
interface Expectation {
  rule: DriftRule
  file: string
  mention: string
}

/** 按路径排序后遍历：选哪个目标不依赖文件系统的遍历顺序。 */
function sortedEntries<T>(map: ReadonlyMap<string, T>): Array<[string, T]> {
  return [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function basename(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1)
}

function noTarget(what: string): never {
  throw new Error(`仓库里找不到可以拿来变异的目标：${what}（装载层或解析层坏了？）`)
}

function headedModules(state: State): Array<[string, string]> {
  return sortedEntries(state.sources).filter(
    ([file]) => MODULE_FILE.test(file) && !isDeclarationPath(file) && !state.touched.has(file)
  )
}

/** 把某个 INPUT 点名的导出在目标文件里改名：消费方的文件头就成了谎话。 */
function renameImportedExport(state: State): Expectation {
  const index = createSourceIndex(state.sources)
  for (const [consumer, text] of headedModules(state)) {
    for (const ref of inputRefs(parseHeader(text).sections.INPUT ?? '')) {
      const target = index.resolveModule(ref.module, consumer)
      if (target.kind !== 'found' || target.path === consumer || state.touched.has(target.path)) {
        continue
      }
      const targetText = state.sources.get(target.path) ?? ''
      for (const symbol of ref.symbols.filter((name) => !name.includes('*'))) {
        const declaration = new RegExp(
          `^(export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|type|interface|enum)\\s+)${escapeRegExp(symbol)}\\b`,
          'm'
        )
        if (!declaration.test(targetText)) continue
        const renamed = targetText.replace(declaration, `$1${symbol}Renamed`)
        const info = exportsOf(renamed, isDeclarationPath(target.path))
        if (info.names.has(symbol) || info.starFrom.length > 0) continue
        state.sources.set(target.path, renamed)
        state.touched.add(target.path).add(consumer)
        return { rule: 'input-not-exported', file: consumer, mention: `${ref.module}::${symbol}` }
      }
    }
  }
  return noTarget('带 INPUT 引用、且被引用的符号是普通声明的文件头')
}

/** 在 OUTPUT 里多写一个并不存在的导出。 */
function lieInOutput(state: State): Expectation {
  for (const [file, text] of headedModules(state)) {
    if (parseHeader(text).sections.OUTPUT === undefined) continue
    const mutated = text.replace(/\[OUTPUT\][ \t]*/, '[OUTPUT] zzGhostExport · ')
    if (!parseHeader(mutated).sections.OUTPUT?.includes('zzGhostExport')) continue
    state.sources.set(file, mutated)
    state.touched.add(file)
    return { rule: 'output-not-exported', file, mention: 'zzGhostExport' }
  }
  return noTarget('带 [OUTPUT] 的文件头')
}

/** 文件头缺一段：把 [POS] 改成不认识的标签。 */
function dropPosTag(state: State): Expectation {
  for (const [file, text] of headedModules(state)) {
    if (parseHeader(text).sections.POS === undefined) continue
    const mutated = text.replace('[POS]', '[ROLE]')
    if (parseHeader(mutated).sections.POS !== undefined) continue
    state.sources.set(file, mutated)
    state.touched.add(file)
    return { rule: 'header-incomplete', file, mention: '[POS]' }
  }
  return noTarget('带 [POS] 的文件头')
}

/** 删掉一个 _ARCH.md / ARCHITECTURE.md 里点过名的源码文件。 */
function deleteMentionedFile(state: State): Expectation {
  for (const [docPath, doc] of sortedEntries(state.docs)) {
    for (const { text } of contentLines(doc)) {
      for (const match of text.matchAll(/`([\w.-]+\.(?:ts|tsx|mts))`/g)) {
        const owners = [...state.paths].filter((file) => basename(file) === match[1])
        if (owners.length !== 1 || state.touched.has(owners[0])) continue
        state.sources.delete(owners[0])
        state.paths.delete(owners[0])
        state.touched.add(owners[0])
        return { rule: 'doc-file-missing', file: docPath, mention: match[1] }
      }
    }
  }
  return noTarget('文档里点名、且仓库里只有一份的源码文件')
}

/** 把某份 _ARCH.md 里对某个文件的登记全部抹掉：新增文件忘了登记就是这个样子。 */
function eraseListing(state: State): Expectation {
  for (const [docPath, doc] of sortedEntries(state.docs)) {
    if (!docPath.endsWith('/_ARCH.md')) continue
    for (const file of sortedEntries(state.sources).map(([name]) => name)) {
      if (dirOf(file) !== dirOf(docPath) || !isCodePath(file)) continue
      if (isTestPath(file) || isDeclarationPath(file) || isFixturePath(file)) continue
      const mention = new RegExp(`(?<![\\w.-])${escapeRegExp(basename(file))}(?![\\w-])`, 'g')
      const redacted = doc.replace(mention, 'REDACTED')
      if (redacted === doc) continue
      state.docs.set(docPath, redacted)
      return { rule: 'arch-file-unlisted', file: docPath, mention: basename(file) }
    }
  }
  return noTarget('登记了本目录源码文件的 _ARCH.md')
}

/** 模块导航里少链一份 _ARCH.md。 */
function unlinkModuleDoc(state: State): Expectation {
  const root = state.docs.get(ROOT_DOC) ?? ''
  for (const docPath of sortedEntries(state.docs).map(([name]) => name)) {
    if (!docPath.endsWith('/_ARCH.md') || !root.includes(`](${docPath})`)) continue
    state.docs.set(ROOT_DOC, root.split(`](${docPath})`).join('](#)'))
    return { rule: 'arch-not-linked', file: ROOT_DOC, mention: docPath }
  }
  return noTarget('模块导航里的 _ARCH.md 链接')
}

/** 文档提到一个代码里根本没有的常量名。 */
function mentionGhostConstant(state: State): Expectation {
  state.docs.set(ROOT_DOC, `${state.docs.get(ROOT_DOC) ?? ''}\n\`GHOST_MUTATION_CONSTANT\`\n`)
  return { rule: 'doc-identifier-missing', file: ROOT_DOC, mention: 'GHOST_MUTATION_CONSTANT' }
}

/** 文档链到一个不存在的文件。 */
function linkMissingFile(state: State): Expectation {
  state.docs.set(ROOT_DOC, `${state.docs.get(ROOT_DOC) ?? ''}\n[x](src/ghost-mutation-target.ts)\n`)
  return { rule: 'doc-link-broken', file: ROOT_DOC, mention: 'src/ghost-mutation-target.ts' }
}

/** 文档给一个常量写了数值，代码里的常量却是另一个数。 */
function contradictDocumentedConstant(state: State): Expectation {
  state.docs.set(ROOT_DOC, `${state.docs.get(ROOT_DOC) ?? ''}\n\`MUTATION_PROBE_LIMIT\`（3）\n`)
  state.sources.set('src/mutationProbe.ts', 'export const MUTATION_PROBE_LIMIT = 2\n')
  state.paths.add('src/mutationProbe.ts')
  return { rule: 'doc-number-mismatch', file: ROOT_DOC, mention: 'MUTATION_PROBE_LIMIT' }
}

const MUTATIONS: ReadonlyArray<{ name: string; apply: (state: State) => Expectation }> = [
  { name: 'renaming an export that another file names in its INPUT', apply: renameImportedExport },
  { name: 'a ghost name in a file header OUTPUT', apply: lieInOutput },
  { name: 'a file header missing its [POS] section', apply: dropPosTag },
  {
    name: 'a doc stating a number that contradicts the constant',
    apply: contradictDocumentedConstant
  },
  { name: 'deleting a source file that a doc names', apply: deleteMentionedFile },
  { name: 'erasing a _ARCH.md listing of a source file', apply: eraseListing },
  { name: 'dropping a _ARCH.md from the module navigation', apply: unlinkModuleDoc },
  { name: 'a doc naming an identifier the code does not have', apply: mentionGhostConstant },
  { name: 'a doc linking to a missing file', apply: linkMissingFile }
]

describe('the guard notices drift injected into the real repository', () => {
  let findings: DriftFinding[] = []
  const expectations: Expectation[] = []

  before(() => {
    const live = loadRepoSnapshot(ROOT)
    const state: State = {
      sources: new Map(live.sources),
      docs: new Map(live.docs),
      paths: new Set(live.paths),
      touched: new Set()
    }
    // 变异按顺序叠加到同一份副本上，只判定一次，真实仓库的整套规则只多跑一遍
    for (const mutation of MUTATIONS) expectations.push(mutation.apply(state))
    findings = checkDocDrift({
      paths: state.paths,
      sources: state.sources,
      docs: state.docs,
      externalModules: live.externalModules
    })
  })

  MUTATIONS.forEach(({ name }, i) => {
    it(`catches ${name}`, () => {
      const { rule, file, mention } = expectations[i]
      assert.ok(
        findings.some(
          (finding) =>
            finding.rule === rule && finding.file === file && finding.message.includes(mention)
        ),
        `没有抓到 [${rule}] ${file} ${mention}；实际报出：\n${formatFindings(findings)}`
      )
    })
  })
})
