// [INPUT] autoSelectStickyPinCore::decideStickyPin/shouldRecheckFixedNodeRegion (POS: 粘性固定与地区复核节流决策) ·
//         autoSelectQualityGuard::admitPinCandidate/settlePinAdmission/reviewPinnedNode/observePinnedNode/resetQualityGuard (POS: 节点质量闸门编排) ·
//         sparkleGeminiProbe::verifyNodeGeminiRegion (POS: Gemini 地区码校验) ·
//         mihomoApi::mihomoGroupDetail/mihomoChangeProxy/mihomoUnfixedProxy (POS: mihomo 控制器访问层) ·
//         sparkle-fast provider 探测结果与单点拨测 ·
//         cursorProxyGroup::AUTO_SELECT_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         defaultAutoSwitchProxy::AUTO_SELECT_DELAY_PROBE_TIMEOUT_MS/AUTO_SELECT_DELAY_PROBE_URL (POS: 自动选择与地区组默认配置) ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] startAutoSelectStickyPin · notifyAutoSelectUnfixed
// [POS] 轮询 `自动选择`：fallback 选出的存活节点稳定后固定下来，让它只在该节点真挂掉时才换；
// 固定前先过质量准入（存活但下载极慢的节点不钉），固定后由质量闸门定期复查；
// 固定被 mihomo 清除时先做单点独立复测（过滤并发体检偶发超时误报）；清理孤儿固定。
// 决策在 autoSelectStickyPinCore，质量判断在 autoSelectQualityGuard；这里只负责轮询与调用 controller。
// 轮询 `GET /proxies/{group}` 不触发 lazy 体检；固定节点的 Gemini 地区复核按 5 分钟节流，避免每 3 秒解析订阅文件。

import { appendAppLog } from '../utils/log'
import {
  admitPinCandidate,
  observePinnedNode,
  resetQualityGuard,
  reviewPinnedNode,
  settlePinAdmission
} from './autoSelectQualityGuard'
import {
  decideStickyPin,
  INITIAL_FIXED_NODE_REGION_CHECK_MEMORY,
  INITIAL_STICKY_PIN_MEMORY,
  recordFixedNodeRegionCheck,
  recordRestoredStickyPin,
  shouldRecheckFixedNodeRegion,
  type AutoSelectGroupSnapshot,
  type FixedNodeRegionCheckMemory,
  type StickyPinMemory
} from './autoSelectStickyPinCore'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import {
  AUTO_SELECT_DELAY_PROBE_TIMEOUT_MS,
  AUTO_SELECT_DELAY_PROBE_URL
} from './defaultAutoSwitchProxy'
import {
  mihomoChangeProxy,
  mihomoGroupDetail,
  mihomoProviderLeafDelay,
  mihomoProxyProviders,
  mihomoUnfixedProxy
} from './mihomoApi'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import { verifyNodeGeminiRegion } from './sparkleGeminiProbe'

/** 回环调用开销可忽略；间隔越短，节点挂掉后到重新固定之间被回切的窗口越小。 */
const POLL_INTERVAL_MS = 3000

let pollTimer: NodeJS.Timeout | undefined
let polling = false
let memory: StickyPinMemory = INITIAL_STICKY_PIN_MEMORY
let fixedRegionCheckMemory: FixedNodeRegionCheckMemory = INITIAL_FIXED_NODE_REGION_CHECK_MEMORY
let lastPinned = ''
let stateGeneration = 0

/** 主动解除固定（启动重排或 UI 点击取消固定）时重置记忆，避免被当成探测失败而把旧节点恢复回去。 */
export function notifyAutoSelectUnfixed(group: string): void {
  if (group !== AUTO_SELECT_GROUP_NAME) {
    return
  }
  stateGeneration += 1
  memory = INITIAL_STICKY_PIN_MEMORY
  fixedRegionCheckMemory = INITIAL_FIXED_NODE_REGION_CHECK_MEMORY
  lastPinned = ''
  resetQualityGuard()
}

async function probeNodeAlive(node: string): Promise<boolean> {
  try {
    const result = await mihomoProviderLeafDelay(
      FAST_NODE_PROVIDER_ID,
      node,
      AUTO_SELECT_DELAY_PROBE_URL,
      AUTO_SELECT_DELAY_PROBE_TIMEOUT_MS
    )
    return typeof result.delay === 'number' && result.delay > 0
  } catch {
    return false
  }
}

/**
 * 确认候选节点存活（与自动组同一测速口径）：
 * - 已有测速记录时直接读 `extra[测速目标].alive`（避免全挂时反复固定死节点）；
 * - 尚无测速记录时（刚启动或 provider 刚重载，顶层 `alive` 默认 true 不可信），
 *   必须做一次单点实测。能否使用 Gemini 由随后的地区校验单独把关。
 */
async function ensureNodeAlive(node: string): Promise<boolean> {
  const provider = (await mihomoProxyProviders()).providers[FAST_NODE_PROVIDER_ID]
  const leaf = provider?.proxies?.find((proxy) => proxy.name === node)
  if (!leaf) {
    return true
  }
  const delayProbe = leaf.extra?.[AUTO_SELECT_DELAY_PROBE_URL]
  if (delayProbe !== undefined) {
    return delayProbe.alive
  }
  return probeNodeAlive(node)
}

/**
 * 钉住准入选中的节点；准入期间组被别处改动（解除固定、换了选中节点、已被固定）则不动它。
 * 候选达标时目标就是候选本身，行为与没有质量闸门时一致。
 */
async function pinNode(candidate: string, target: string, startGen: number): Promise<boolean> {
  if (startGen !== stateGeneration) {
    return false
  }
  const latest = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
  if (latest.fixed || latest.now !== candidate || !latest.all.includes(target)) {
    return false
  }
  await mihomoChangeProxy(AUTO_SELECT_GROUP_NAME, target)
  memory = { ...memory, pinned: target }
  fixedRegionCheckMemory = recordFixedNodeRegionCheck(target)
  const left = lastPinned && lastPinned !== target ? ` (left ${lastPinned})` : ''
  lastPinned = target
  await appendAppLog(`[AutoSelectSticky]: pinned ${target}${left}\n`)
  return true
}

/** 候选已确认存活：先过地区校验，再过质量准入，最后钉住；准入的收尾无论钉没钉成都要做。 */
async function pinAdmittedNode(
  candidate: string,
  group: AutoSelectGroupSnapshot,
  startGen: number
): Promise<void> {
  const regionCheck = await verifyNodeGeminiRegion(candidate)
  if (regionCheck.definitive && !regionCheck.eligible) {
    memory = INITIAL_STICKY_PIN_MEMORY
    await appendAppLog(
      `[AutoSelectSticky]: rejected region-restricted node ${candidate} (region=${regionCheck.countryCode})\n`
    )
    return
  }
  const admission = await admitPinCandidate(candidate, group)
  const pinned = await pinNode(candidate, admission.node, startGen)
  await settlePinAdmission(admission, pinned)
}

async function pollOnce(): Promise<void> {
  const startGen = stateGeneration
  const group = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
  observePinnedNode(group.fixed)
  const decision = decideStickyPin(group, memory)
  memory = decision.memory
  if (memory.pinned) {
    lastPinned = memory.pinned
  }

  const { action } = decision
  if (!group.fixed) {
    fixedRegionCheckMemory = INITIAL_FIXED_NODE_REGION_CHECK_MEMORY
  } else if (shouldRecheckFixedNodeRegion(group.fixed, fixedRegionCheckMemory)) {
    fixedRegionCheckMemory = recordFixedNodeRegionCheck(group.fixed)
    const regionCheck = await verifyNodeGeminiRegion(group.fixed)
    if (regionCheck.definitive && !regionCheck.eligible) {
      await mihomoUnfixedProxy(AUTO_SELECT_GROUP_NAME)
      memory = INITIAL_STICKY_PIN_MEMORY
      fixedRegionCheckMemory = INITIAL_FIXED_NODE_REGION_CHECK_MEMORY
      await appendAppLog(
        `[AutoSelectSticky]: unfixed region-restricted node ${group.fixed} (region=${regionCheck.countryCode})\n`
      )
      return
    }
  }

  if (action.kind === 'unfix') {
    await mihomoUnfixedProxy(AUTO_SELECT_GROUP_NAME)
    fixedRegionCheckMemory = INITIAL_FIXED_NODE_REGION_CHECK_MEMORY
    await appendAppLog(`[AutoSelectSticky]: released orphan pin ${action.orphan}\n`)
    return
  }

  if (action.kind === 'verify-lost-pin') {
    const alive = await probeNodeAlive(action.node)
    if (!alive) {
      await appendAppLog(`[AutoSelectSticky]: confirmed dead ${action.node}\n`)
      return
    }
    const regionCheck = await verifyNodeGeminiRegion(action.node)
    if (regionCheck.definitive && !regionCheck.eligible) {
      await appendAppLog(
        `[AutoSelectSticky]: dropped lost pin on region-restricted node ${action.node} (region=${regionCheck.countryCode})\n`
      )
      return
    }
    if (startGen !== stateGeneration) {
      return
    }
    const latest = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
    if (!latest.fixed && latest.all.includes(action.node)) {
      await mihomoChangeProxy(AUTO_SELECT_GROUP_NAME, action.node)
      memory = recordRestoredStickyPin(action.node, Date.now())
      fixedRegionCheckMemory = recordFixedNodeRegionCheck(action.node)
      lastPinned = action.node
      await appendAppLog(`[AutoSelectSticky]: restored ${action.node} after single probe blip\n`)
    }
    return
  }

  if (action.kind === 'pin') {
    if (await ensureNodeAlive(action.node)) {
      await pinAdmittedNode(action.node, group, startGen)
    }
    return
  }

  await reviewPinnedNode(group)
}

/** 幂等：内核重启后无需重复注册；内核不可达或组不存在时静默跳过本轮。 */
export function startAutoSelectStickyPin(): void {
  if (pollTimer) {
    return
  }
  pollTimer = setInterval(() => {
    if (polling) {
      return
    }
    polling = true
    pollOnce()
      .catch(() => {
        memory = INITIAL_STICKY_PIN_MEMORY
      })
      .finally(() => {
        polling = false
      })
  }, POLL_INTERVAL_MS)
  pollTimer.unref()
}
