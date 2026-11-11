// [INPUT] autoSelectStickyPinCore::decideStickyPin/shouldRecheckFixedNodeRegion (POS: 粘性固定与地区复核节流决策) ·
//         sparkleGeminiProbe::verifyNodeGeminiRegion (POS: Gemini 地区码校验) ·
//         mihomoApi::mihomoGroupDetail/mihomoChangeProxy/mihomoUnfixedProxy (POS: mihomo 控制器访问层) ·
//         sparkle-fast provider 探测结果与单点拨测
// [OUTPUT] startAutoSelectStickyPin · notifyAutoSelectUnfixed
// [POS] 轮询 `自动选择`：fallback 选出的存活节点稳定后固定下来，让它只在该节点真挂掉时才换；
// 固定被 mihomo 清除时先做单点独立复测（过滤并发体检偶发超时误报）；清理孤儿固定。
// 决策在 autoSelectStickyPinCore；这里只负责轮询与调用 controller。
// 轮询 `GET /proxies/{group}` 不触发 lazy 体检；固定节点的 Gemini 地区复核按 5 分钟节流，避免每 3 秒解析订阅文件。

import { appendAppLog } from '../utils/log'
import {
  decideStickyPin,
  INITIAL_FIXED_NODE_REGION_CHECK_MEMORY,
  INITIAL_STICKY_PIN_MEMORY,
  recordFixedNodeRegionCheck,
  recordRestoredStickyPin,
  shouldRecheckFixedNodeRegion,
  type FixedNodeRegionCheckMemory,
  type StickyPinMemory
} from './autoSelectStickyPinCore'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import {
  AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
  AUTO_SELECT_GEMINI_PROBE_URL
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
}

async function probeNodeGeminiAlive(node: string): Promise<boolean> {
  try {
    const result = await mihomoProviderLeafDelay(
      FAST_NODE_PROVIDER_ID,
      node,
      AUTO_SELECT_GEMINI_PROBE_URL,
      AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS
    )
    return typeof result.delay === 'number' && result.delay > 0
  } catch {
    return false
  }
}

/**
 * 确认候选节点对 Gemini 存活：
 * - 已有 Gemini 探测记录时直接读 `extra[Gemini].alive`（避免全挂时反复固定死节点）；
 * - 尚无 Gemini 记录时（刚启动或 provider 刚重载，顶层 `alive` 仅代表 gstatic 或默认 true），
 *   必须做一次单点 Gemini 实测，防止把「gstatic 通但 Gemini 不通」的节点固定住。
 */
async function ensureNodeAliveForGemini(node: string): Promise<boolean> {
  const provider = (await mihomoProxyProviders()).providers[FAST_NODE_PROVIDER_ID]
  const leaf = provider?.proxies?.find((proxy) => proxy.name === node)
  if (!leaf) {
    return true
  }
  const geminiProbe = leaf.extra?.[AUTO_SELECT_GEMINI_PROBE_URL]
  if (geminiProbe !== undefined) {
    return geminiProbe.alive
  }
  return probeNodeGeminiAlive(node)
}

async function pollOnce(): Promise<void> {
  const startGen = stateGeneration
  const group = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
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
    const alive = await probeNodeGeminiAlive(action.node)
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

  if (action.kind === 'pin' && (await ensureNodeAliveForGemini(action.node))) {
    const regionCheck = await verifyNodeGeminiRegion(action.node)
    if (regionCheck.definitive && !regionCheck.eligible) {
      memory = INITIAL_STICKY_PIN_MEMORY
      await appendAppLog(
        `[AutoSelectSticky]: rejected region-restricted node ${action.node} (region=${regionCheck.countryCode})\n`
      )
      return
    }
    if (startGen !== stateGeneration) {
      return
    }
    const latest = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
    if (!latest.fixed && latest.now === action.node && latest.all.includes(action.node)) {
      await mihomoChangeProxy(AUTO_SELECT_GROUP_NAME, action.node)
      memory = { ...memory, pinned: action.node }
      fixedRegionCheckMemory = recordFixedNodeRegionCheck(action.node)
      const left = lastPinned && lastPinned !== action.node ? ` (left ${lastPinned})` : ''
      lastPinned = action.node
      await appendAppLog(`[AutoSelectSticky]: pinned ${action.node}${left}\n`)
    }
  }
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
