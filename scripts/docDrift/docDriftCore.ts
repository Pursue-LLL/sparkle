// [INPUT] docDriftHeaderRules::checkHeaders (POS: 文档漂移守护的文件头规则，只管「写了就必须是真的」) ·
//         docDriftDocRules::checkDocs (POS: 文档漂移守护的文档规则，核对文档点名的东西还在不在) ·
//         docDriftNumberRules::checkDocNumbers/collectConstants (POS: 文档漂移守护的数值规则，只判定数值与常量名挂在一起的写法) ·
//         docDriftIndex::createSourceIndex/isFixturePath/isTestPath/RepoSnapshot/DriftFinding (POS: 文档漂移守护的数据模型与源码索引，规则层只和内存快照打交道) ·
//         docDriftParse::collectWords (POS: 文档漂移守护的文本解析层，从源码文本读出文件头、导出与标识符)
// [OUTPUT] checkDocDrift: 对一份仓库快照跑全部规则，返回排好序的漂移列表 · formatFinding / formatFindings: 逐条报错文本 ·
//          formatDriftReport: 整份漂移报告（条数、怎么改、逐条明细）
// [POS] 文档漂移守护的入口：文件头（L4）、`_ARCH.md`（L3）、`ARCHITECTURE.md`（L1）与代码是否一致，一次判完。
//       纯函数，不读磁盘；快照由 docDriftRepo 从真实仓库装载，单测则直接喂几行字符串。
//       仓库测试与装包前门禁共用 formatDriftReport 这一段报错文字，两处看到的漂移说明不会各写各的。
import { checkDocs } from './docDriftDocRules'
import { checkHeaders } from './docDriftHeaderRules'
import {
  createSourceIndex,
  isFixturePath,
  isTestPath,
  type DriftFinding,
  type RepoSnapshot
} from './docDriftIndex'
import { checkDocNumbers, collectConstants } from './docDriftNumberRules'
import { collectWords } from './docDriftParse'

const GUARD_DIR = 'scripts/docDrift/'

/**
 * 守护自己的测试与夹具里全是编造的示例名字，不算「代码事实」：算进去，它们会让文档里同名的过期标识符也查得到。
 * 守护的生产代码与别处的代码一样是代码，文档可以点它的名字。
 */
function isGuardSample(path: string): boolean {
  return path.startsWith(GUARD_DIR) && (isTestPath(path) || isFixturePath(path))
}

export function checkDocDrift(snapshot: RepoSnapshot): DriftFinding[] {
  const index = createSourceIndex(snapshot.sources)
  const productSources = new Map([...snapshot.sources].filter(([path]) => !isGuardSample(path)))
  const words = new Set<string>()
  for (const text of productSources.values()) collectWords(text, words)

  return [
    ...checkHeaders(snapshot.sources, index, snapshot.externalModules),
    ...checkDocs(snapshot, words),
    ...checkDocNumbers(snapshot.docs, collectConstants(productSources))
  ].sort(
    (a, b) =>
      a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule)
  )
}

export function formatFinding(finding: DriftFinding): string {
  const where = finding.line === null ? finding.file : `${finding.file}:${finding.line}`
  return `${where} [${finding.rule}] ${finding.message}`
}

export function formatFindings(findings: readonly DriftFinding[]): string {
  return findings.map(formatFinding).join('\n')
}

/** 只描述漂移，不决定过不过：过与拦由调用方按漂移列表是否为空判定，报告文字出了问题不会影响结论。 */
export function formatDriftReport(findings: readonly DriftFinding[]): string {
  return `文档与代码不一致，共 ${findings.length} 处（改代码后同步文档，或改文档对齐代码）：\n${formatFindings(findings)}`
}
