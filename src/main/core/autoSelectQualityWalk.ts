// [INPUT] sparkleNodeQualityCore::judgePrimaryForAdmission/controlVetoes/classifyIncumbent/MAX_UNMEASURED_FAILURES/ThroughputReading (POS: 节点质量闸门纯决策层)
// [OUTPUT] walkForQualifiedNode · describeReading · ProbeRole · WalkContext · WalkOutcome · WalkRejection
// [POS] 候选遍历：按序逐个验证候选节点（地区 → 主目标吞吐 → 对照目标），第一个合格者即停。
// 准入（钉住前）与复查替换（钉住后）共用这一条路径，保证两处对「合格」的定义一致。
// 探测、地区校验、取消都由调用方注入，本模块不碰 IO，行为可以脱离 mihomo 直接测试。

import {
  classifyIncumbent,
  controlVetoes,
  judgePrimaryForAdmission,
  MAX_UNMEASURED_FAILURES,
  type ThroughputReading
} from './sparkleNodeQualityCore'

/** 主目标是用户真正关心的站点（Google），对照目标是与之无关的站点，只用来排除主目标上的偶然读数。 */
export type ProbeRole = 'primary' | 'control'

export interface WalkContext {
  measure: (node: string, role: ProbeRole) => Promise<ThroughputReading>
  /** 确认锁区/送中的节点不可用；没有结论时放行。 */
  isRegionEligible: (node: string) => Promise<boolean>
  isAdmittedRecently: (node: string) => boolean
  isCancelled: () => boolean
}

/** 被判为不达标的候选；`degraded` 表示读数明确低于判劣线（或根本没有数据），而不只是没到准入线。 */
export interface WalkRejection {
  node: string
  detail: string
  degraded: boolean
}

export type WalkOutcome =
  | { kind: 'passed'; node: string; detail: string; rejected: WalkRejection[] }
  /** 候选都测过了，没有一个达标。 */
  | { kind: 'exhausted'; rejected: WalkRejection[] }
  /** 测不出有意义的结果（探测设施不可用，或前几个候选连数据都读不到），应当放行而不是继续消耗流量。 */
  | { kind: 'unverified'; reason: string; rejected: WalkRejection[] }
  | { kind: 'cancelled' }

export function describeReading(reading: ThroughputReading): string {
  if (reading.kind === 'measured') {
    return `${Math.round(reading.kbps)} KB/s`
  }
  return reading.kind === 'failed' ? 'no data' : 'unavailable'
}

export async function walkForQualifiedNode(
  candidates: readonly string[],
  context: WalkContext
): Promise<WalkOutcome> {
  const rejected: WalkRejection[] = []
  let readableCount = 0
  let unreadableCount = 0

  for (const node of candidates) {
    if (context.isCancelled()) {
      return { kind: 'cancelled' }
    }
    if (!(await context.isRegionEligible(node))) {
      continue
    }
    if (context.isAdmittedRecently(node)) {
      return { kind: 'passed', node, detail: 'admitted moments ago', rejected }
    }

    const primary = await context.measure(node, 'primary')
    const verdict = judgePrimaryForAdmission(primary)
    if (verdict === 'unknown') {
      return { kind: 'unverified', reason: 'probe channel unavailable', rejected }
    }
    if (primary.kind === 'measured') {
      readableCount += 1
    } else {
      unreadableCount += 1
    }
    const google = `google ${describeReading(primary)}`

    if (verdict === 'reject') {
      rejected.push({ node, detail: google, degraded: classifyIncumbent(primary) === 'degraded' })
      if (readableCount === 0 && unreadableCount >= MAX_UNMEASURED_FAILURES) {
        return {
          kind: 'unverified',
          reason: 'no readable data from the first candidates',
          rejected
        }
      }
      continue
    }

    const control = await context.measure(node, 'control')
    const detail = `${google}, control ${describeReading(control)}`
    if (controlVetoes(control)) {
      rejected.push({ node, detail, degraded: true })
      continue
    }
    return { kind: 'passed', node, detail, rejected }
  }
  return { kind: 'exhausted', rejected }
}
