// [INPUT] autoSelectQualityWalk::walkForQualifiedNode/describeReading (POS: 候选遍历) ·
//         sparkleNodeQualityCore (POS: 节点质量闸门纯决策层) ·
//         sparkleThroughputProbe::measureNodeThroughput/GOOGLE_TARGET/CONTROL_TARGET (POS: 单节点下载吞吐实测) ·
//         sparkleNodeQualityCache::loadSunkNodeNames/markNodesSunk (POS: 沉底节点持久化) ·
//         sparkleGeminiProbe::verifyNodeGeminiRegion/rebuildAndReloadSparkleFastProvider (POS: Gemini 地区校验与 provider 重建) ·
//         sparkleFastLatencyOrderCore::collectNodeDelays (POS: 探测历史折算) ·
//         mihomoApi::mihomoChangeProxy/mihomoCloseConnections/mihomoGroupDetail/mihomoProxyProviders (POS: mihomo 控制器访问层) ·
//         autoSelectStickyPinCore::AutoSelectGroupSnapshot (POS: 粘性固定决策) ·
//         cursorProxyGroup::AUTO_SELECT_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         defaultAutoSwitchProxy::AUTO_SELECT_DELAY_PROBE_URL (POS: 自动选择与地区组默认配置) ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] admitPinCandidate · settlePinAdmission · reviewPinnedNode · observePinnedNode · resetQualityGuard · PIN_LOSS_GRACE_POLLS · PinAdmission
// [POS] `自动选择` 节点质量闸门的编排层：钉住前的准入（跳过「能连通但下载极慢」的节点）、
// 钉住后每 2 小时的原位复查，以及复查确认劣化后的原位替换。
// 复查状态同时就是「这个固定是我们钉的」的标记：用户手动固定的节点没有复查状态，永远不会被动。
// 所有探测/控制器异常都放行（保持原有行为），闸门只会让结果变好，不会让它变坏。

import { appendAppLog } from '../utils/log'
import { describeReading, walkForQualifiedNode, type WalkContext } from './autoSelectQualityWalk'
import type { AutoSelectGroupSnapshot } from './autoSelectStickyPinCore'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import { AUTO_SELECT_DELAY_PROBE_URL } from './defaultAutoSwitchProxy'
import {
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoGroupDetail,
  mihomoProxyProviders
} from './mihomoApi'
import { collectNodeDelays } from './sparkleFastLatencyOrderCore'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import { rebuildAndReloadSparkleFastProvider, verifyNodeGeminiRegion } from './sparkleGeminiProbe'
import { loadSunkNodeNames, markNodesSunk } from './sparkleNodeQualityCache'
import {
  ADMISSION_KBPS,
  ADMISSION_MEMORY_MS,
  advanceReview,
  classifyIncumbent,
  isReviewDue,
  planCandidateWalk,
  REVIEW_INTERVAL_MS,
  startReview,
  UNVERIFIED_PIN_REVIEW_MS,
  type ReviewState
} from './sparkleNodeQualityCore'
import { CONTROL_TARGET, GOOGLE_TARGET, measureNodeThroughput } from './sparkleThroughputProbe'

/**
 * 固定被 mihomo 清掉后，最多等这么多轮轮询（3 秒一轮）它被放回来；
 * 超过就不再认它是我们钉的，之后同一节点被用户手动固定时不该被复查。
 */
export const PIN_LOSS_GRACE_POLLS = 20

export interface PinAdmission {
  /** 实际要钉住的节点：通常就是候选，候选不达标时是遍历选中的替代节点。 */
  node: string
  /** 经过了质量验证；放行（设施不可用、没有达标节点）时为 false，会更早复查。 */
  verified: boolean
  /** 本轮因实测不达标而沉底的节点。 */
  sunk: readonly string[]
  /**
   * 被替代节点放弃的原候选，且它的读数明确劣化（或早已沉底）：
   * 切换只影响新连接，旧连接会一直留在这个慢节点上，必须关掉才会换线。
   */
  abandoned: string | undefined
}

let review: ReviewState | undefined
let unpinnedPolls = 0
let generation = 0
const admittedAtMs = new Map<string, number>()

const log = (message: string): Promise<void> => appendAppLog(`[AutoSelectQuality]: ${message}\n`)

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function isAdmittedRecently(node: string): boolean {
  const admittedAt = admittedAtMs.get(node)
  return admittedAt !== undefined && Date.now() - admittedAt < ADMISSION_MEMORY_MS
}

function rememberAdmitted(node: string): void {
  const now = Date.now()
  for (const [name, admittedAt] of admittedAtMs) {
    if (now - admittedAt >= ADMISSION_MEMORY_MS) {
      admittedAtMs.delete(name)
    }
  }
  admittedAtMs.set(node, now)
}

function createWalkContext(startGeneration: number): WalkContext {
  return {
    measure: (node, role) =>
      measureNodeThroughput(node, role === 'primary' ? GOOGLE_TARGET : CONTROL_TARGET),
    isRegionEligible: async (node) => {
      const verdict = await verifyNodeGeminiRegion(node)
      return !(verdict.definitive && !verdict.eligible)
    },
    isAdmittedRecently,
    isCancelled: () => startGeneration !== generation
  }
}

/** 只有已知存活的节点才进入遍历：为凑候选去逐个实测未探测的节点，代价远大于收益。 */
async function loadWalkInputs(): Promise<{
  alive: ReadonlySet<string>
  sunk: ReadonlySet<string>
}> {
  const [providers, sunk] = await Promise.all([mihomoProxyProviders(), loadSunkNodeNames()])
  const leaves = providers.providers[FAST_NODE_PROVIDER_ID]?.proxies ?? []
  return { alive: new Set(collectNodeDelays(leaves, AUTO_SELECT_DELAY_PROBE_URL).keys()), sunk }
}

async function logSkipped(rejected: readonly { node: string; detail: string }[]): Promise<void> {
  for (const { node, detail } of rejected) {
    await log(`skipped ${node} (${detail})`)
  }
}

/** 关闭失败不应连累已经完成的切换；旧连接最多是留到自然结束。 */
async function closeConnectionsQuietly(node: string): Promise<void> {
  try {
    await mihomoCloseConnections(node)
  } catch (error) {
    await log(`could not close connections of ${node}: ${errorMessage(error)}`)
  }
}

/**
 * 候选节点钉住之前的质量准入：候选不达标就顺着 fallback 的顺序找第一个达标的存活节点。
 * 只有「找到了达标节点」才把不达标的节点沉底（比较证据）：没有任何替代时沉底只会让池子更差。
 * 任何失败都放行候选，行为与没有这道闸时一致。
 */
export async function admitPinCandidate(
  candidate: string,
  group: AutoSelectGroupSnapshot
): Promise<PinAdmission> {
  const unverified: PinAdmission = {
    node: candidate,
    verified: false,
    sunk: [],
    abandoned: undefined
  }
  if (isAdmittedRecently(candidate)) {
    return { ...unverified, verified: true }
  }

  const startGeneration = generation
  try {
    const { alive, sunk } = await loadWalkInputs()
    const outcome = await walkForQualifiedNode(
      planCandidateWalk({ first: candidate, order: group.all, alive, sunk }),
      createWalkContext(startGeneration)
    )
    if (outcome.kind === 'cancelled') {
      return unverified
    }
    await logSkipped(outcome.rejected)
    if (outcome.kind === 'exhausted') {
      await log(`no candidate reached ${ADMISSION_KBPS} KB/s, pinning ${candidate} as is`)
      return unverified
    }
    if (outcome.kind === 'unverified') {
      await log(`could not verify ${candidate} (${outcome.reason}), pinning it unchecked`)
      return unverified
    }

    const rejectedNodes = outcome.rejected.map((item) => item.node)
    // 先落盘再继续：地区复核被拒、竞态重试都会让同一批候选再来一轮，不能重复测量
    await markNodesSunk(rejectedNodes)
    rememberAdmitted(outcome.node)
    await log(
      outcome.node === candidate
        ? `admitted ${outcome.node} (${outcome.detail})`
        : `admitted ${outcome.node} instead of ${candidate} (${outcome.detail})`
    )
    // 遍历既不会放行也不会再测沉底或被拒的节点，所以这里成立就一定换了节点
    const candidateDegraded =
      sunk.has(candidate) ||
      outcome.rejected.some((item) => item.node === candidate && item.degraded)
    return {
      node: outcome.node,
      verified: true,
      sunk: rejectedNodes,
      abandoned: candidateDegraded ? candidate : undefined
    }
  } catch (error) {
    await log(`admission failed for ${candidate}, pinning it unchecked: ${errorMessage(error)}`)
    return unverified
  }
}

/**
 * 准入之后的收尾，钉没钉成都要调用：
 * - 沉底的节点要重写 provider，让 fallback 不再回到它们；
 * - 钉成了才开始复查计时，并关掉被放弃的原候选上的连接。
 */
export async function settlePinAdmission(admission: PinAdmission, pinned: boolean): Promise<void> {
  if (pinned) {
    review = startReview(
      admission.node,
      Date.now(),
      admission.verified ? REVIEW_INTERVAL_MS : UNVERIFIED_PIN_REVIEW_MS
    )
    unpinnedPolls = 0
    if (admission.abandoned) {
      await closeConnectionsQuietly(admission.abandoned)
    }
  }
  if (admission.sunk.length > 0) {
    await rebuildAndReloadSparkleFastProvider()
  }
}

/**
 * 每轮轮询开头同步固定状态，保持「复查状态 = 我们钉的那个节点」：
 * 别处固定了别的节点就丢弃；固定短暂消失（等着被放回）则保留，消失太久也丢弃。
 */
export function observePinnedNode(fixed: string | undefined): void {
  if (!review) {
    return
  }
  if (fixed === review.node) {
    unpinnedPolls = 0
    return
  }
  if (fixed) {
    review = undefined
    return
  }
  unpinnedPolls += 1
  if (unpinnedPolls > PIN_LOSS_GRACE_POLLS) {
    review = undefined
  }
}

/** 用户取消固定、启动重排等主动解除时调用：进行中的遍历作废，复查与准入记忆清空。 */
export function resetQualityGuard(): void {
  generation += 1
  review = undefined
  unpinnedPolls = 0
  admittedAtMs.clear()
}

/**
 * 复查确认劣化后原位替换：沉底旧节点（及本轮试过的不达标者），固定新节点，再关旧节点的连接。
 * 找不到达标的替代时保留旧节点，不沉底、不改动。
 */
async function replaceDegradedPin(
  incumbent: string,
  group: AutoSelectGroupSnapshot,
  startGeneration: number
): Promise<void> {
  try {
    const { alive, sunk } = await loadWalkInputs()
    const outcome = await walkForQualifiedNode(
      planCandidateWalk({ order: group.all, alive, sunk, exclude: incumbent }),
      createWalkContext(startGeneration)
    )
    if (outcome.kind === 'cancelled') {
      return
    }
    await logSkipped(outcome.rejected)
    if (outcome.kind !== 'passed') {
      const reason =
        outcome.kind === 'exhausted' ? 'no replacement reached the line' : outcome.reason
      review = startReview(
        incumbent,
        Date.now(),
        outcome.kind === 'unverified' ? UNVERIFIED_PIN_REVIEW_MS : REVIEW_INTERVAL_MS
      )
      await log(`keeping degraded ${incumbent} (${reason})`)
      return
    }

    const latest = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
    if (
      startGeneration !== generation ||
      latest.fixed !== incumbent ||
      !latest.all.includes(outcome.node)
    ) {
      return
    }
    await markNodesSunk([incumbent, ...outcome.rejected.map((item) => item.node)])
    await mihomoChangeProxy(AUTO_SELECT_GROUP_NAME, outcome.node)
    review = startReview(outcome.node, Date.now())
    await log(`replaced degraded ${incumbent} with ${outcome.node} (${outcome.detail})`)
    await closeConnectionsQuietly(incumbent)
    await rebuildAndReloadSparkleFastProvider()
  } catch (error) {
    review = startReview(incumbent, Date.now(), UNVERIFIED_PIN_REVIEW_MS)
    await log(`replacement failed, keeping ${incumbent}: ${errorMessage(error)}`)
  }
}

/**
 * 到期时给我们钉的节点测一次主目标吞吐。首次读数劣化先等约一分钟再测一次，
 * 两次都劣化才替换：单次读数可漂移数倍，一次低读数不足以让用户的节点被换掉。
 */
export async function reviewPinnedNode(group: AutoSelectGroupSnapshot): Promise<void> {
  const state = review
  if (!state || state.node !== group.fixed || !isReviewDue(state, Date.now())) {
    return
  }
  const startGeneration = generation
  const reading = await measureNodeThroughput(state.node, GOOGLE_TARGET)
  if (startGeneration !== generation) {
    return
  }

  const health = classifyIncumbent(reading)
  const outcome = advanceReview(state, health, Date.now())
  review = outcome.state
  if (outcome.degraded) {
    await log(`${state.node} confirmed degraded (google ${describeReading(reading)})`)
    await replaceDegradedPin(state.node, group, startGeneration)
  } else if (health === 'degraded') {
    await log(`${state.node} looks degraded (google ${describeReading(reading)}), checking again`)
  }
}
