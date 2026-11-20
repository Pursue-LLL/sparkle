// [INPUT] docDriftIndex::RepoSnapshot/DriftRule (POS: 文档漂移守护的数据模型与源码索引，规则层只和内存快照打交道) ·
//         docDriftCore::checkDocDrift/formatFinding (POS: 文档漂移守护的入口，一次判完文件头、_ARCH.md、ARCHITECTURE.md 与代码是否一致)
// [OUTPUT] SnapshotParts · snapshotOf: 用几行字符串拼出一份内存快照 · headerOf: 拼文件头注释 ·
//          findingsOf: 跑全部规则并把每条结果格式化成文本 · rulesOf: 只取触发的规则名
// [POS] 文档漂移守护各测试共用的夹具：规则层只读内存快照，所以每条规则的正反例都是几行字符串，不碰磁盘。
import { checkDocDrift, formatFinding } from './docDriftCore'
import type { DriftRule, RepoSnapshot } from './docDriftIndex'

export interface SnapshotParts {
  /** 源码：相对路径 → 文本 */
  sources?: Record<string, string>
  /** 文档：相对路径 → 文本 */
  docs?: Record<string, string>
  /** 额外存在的文件（非源码、非文档，如被链接的 md） */
  paths?: string[]
  /** npm 依赖与内置模块名 */
  external?: string[]
}

export function snapshotOf(parts: SnapshotParts): RepoSnapshot {
  const sources = new Map(Object.entries(parts.sources ?? {}))
  const docs = new Map(Object.entries(parts.docs ?? {}))
  return {
    paths: new Set([...sources.keys(), ...docs.keys(), ...(parts.paths ?? [])]),
    sources,
    docs,
    externalModules: new Set(parts.external ?? [])
  }
}

/** 拼文件头注释；没给的标签整段不写，用来造「只写了部分标签」的文件。 */
export function headerOf(parts: { input?: string; output?: string; pos?: string }): string {
  const lines: string[] = []
  if (parts.input !== undefined) lines.push(`// [INPUT] ${parts.input}`)
  if (parts.output !== undefined) lines.push(`// [OUTPUT] ${parts.output}`)
  if (parts.pos !== undefined) lines.push(`// [POS] ${parts.pos}`)
  return lines.join('\n')
}

export function findingsOf(snapshot: RepoSnapshot): string[] {
  return checkDocDrift(snapshot).map(formatFinding)
}

export function rulesOf(snapshot: RepoSnapshot): DriftRule[] {
  return checkDocDrift(snapshot).map((finding) => finding.rule)
}
