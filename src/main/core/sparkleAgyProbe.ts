// [INPUT] 当前订阅节点 · agy 组操作（sparkleAgyGroupControl）· 探测缓存（sparkleAgyProbeCache）· 展示快照（sparkleAgyProbeSnapshot）· 巡检状态（sparkleAgyState）·
//         cursorProxyGroup::AGY_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         mihomoApi::subscribeMihomoAlerts (POS: mihomo 控制器访问层) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleAgyProbeCore::AGY_PIN_CHECK_INTERVAL_MS/createAgyDialFailureWatch/shouldRepairAgyPin/AgyAuditOutcome (POS: agy 巡检状态机) ·
//         sparkleAgyProviderCore::AgyNodeProbeRecord/AgyProbeVerdict/AgyProxyRecord (POS: agy provider 与分组配置) ·
//         sparkleAgyRepair::repairPin (POS: agy 修复扫描) · sparkleAgyRound::openRound/AgyRound (POS: agy 一轮巡检上下文) ·
//         utils/errorMessage::describeError (POS: 失败路径上的异常文本化) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志) ·
//         dedicatedGroups::runWhenEnabled (POS: 可开关专用组注册表与开关解析)
// [OUTPUT] bootstrapSparkleAgyProvider · repairSparkleAgyPinOnDialFailures · startSparkleAgyProbeLoop
// [POS] 用官方 agy CLI 的真实请求给节点定性：200 = 可用，地区被拒（生成请求的 400 `User location is not supported`，
// 或 aicode 的 `LOCATION_NOT_ELIGIBLE`）= 不可用。
// 本模块只做巡检编排：pin 就地复测 → 必要时修复扫描（sparkleAgyRepair）→ 收敛 provider；
// 修复扫描有两个入口：定时复测判定 pin 不可用，或生产流量在 agy 出口上的拨号失败风暴（被动触发，越过 pin 复测）。
// CLI 请求在 sparkleAgyCli，对 `🎯 agy 专用` 组的操作在 sparkleAgyGroupControl。
// 编排状态（退避、超时累计、已试记录）经 sparkleAgyState 落盘，每轮开头读出、结尾写回。
// 定时与被动两个入口都经开关门控：`🎯 agy 专用` 关闭则整轮跳过、不发任何请求。

import { appendAppLog } from '../utils/log'
import { describeError } from '../utils/errorMessage'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { subscribeMihomoAlerts } from './mihomoApi'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { convergeAgyProvider, probeSingleNode, selectAgyNode } from './sparkleAgyGroupControl'
import { saveSparkleAgyProbeCache } from './sparkleAgyProbeCache'
import {
  AGY_PIN_CHECK_INTERVAL_MS,
  createAgyDialFailureWatch,
  shouldRepairAgyPin,
  type AgyAuditOutcome
} from './sparkleAgyProbeCore'
import { syncAgyProbeSnapshot } from './sparkleAgyProbeSnapshot'
import type { AgyNodeProbeRecord, AgyProbeVerdict, AgyProxyRecord } from './sparkleAgyProviderCore'
import { repairPin } from './sparkleAgyRepair'
import { openRound, type AgyRound } from './sparkleAgyRound'
import { clearAgyRepairBackoff, openAgyState, type AgyState } from './sparkleAgyState'
import { runWhenEnabled, type DedicatedGroupGate } from './dedicatedGroups'

/**
 * pin 复测的探测超时：agy CLI 冷启动 + 模型排队可能超过 30s，给足 90s。
 * 慢 ≠ 坏；超时只记 unknown，不把节点判死。
 */
const PIN_PROBE_TIMEOUT_MS = 90_000

let probeInFlight = false

function recordPinOutcome(
  cache: Map<string, AgyNodeProbeRecord>,
  proxy: AgyProxyRecord,
  outcome: AgyAuditOutcome
): boolean {
  const fingerprint = computeProxyNodeFingerprint(proxy)
  const previous = cache.get(fingerprint)
  const usable = outcome.verdict === 'usable'
  cache.set(fingerprint, {
    usable,
    rttMs: outcome.rttMs,
    checkedAt: Date.now()
  })
  return !previous || previous.usable !== usable
}

/** pin 复测结论；agy CLI 不可用时继续巡检没有意义，本轮放弃。verdict 为 null 表示没有 pin 可测。 */
type PinCheck = { aborted: true } | { aborted: false; verdict: AgyProbeVerdict | null }

/**
 * ① pin 就地复测：不切组、不关连接、不影响正在进行的会话。
 * 400 可能是账号轮转造成的：同节点再确认一次，两次都 400 才认定节点被拒；
 * 超时不复测，按轮次累计（上游整体变慢时不能反复把生产出口拖去扫一遍）。
 */
async function checkPin(round: AgyRound): Promise<PinCheck> {
  const { cache, proxies, pinName, pinProxy, state } = round
  if (!pinName || !pinProxy) {
    state.pinUnknownStreak = 0
    return { aborted: false, verdict: null }
  }

  let outcome = await probeSingleNode(pinName, PIN_PROBE_TIMEOUT_MS)
  if (outcome.fatal) {
    return { aborted: true }
  }
  if (outcome.verdict === 'unusable') {
    outcome = await probeSingleNode(pinName, PIN_PROBE_TIMEOUT_MS)
    if (outcome.fatal) {
      return { aborted: true }
    }
  }
  if (outcome.verdict !== 'unknown') {
    const changed = recordPinOutcome(cache, pinProxy, outcome)
    if (changed) {
      await saveSparkleAgyProbeCache(cache)
    }
  }
  syncAgyProbeSnapshot(cache, proxies)
  state.pinUnknownStreak = outcome.verdict === 'unknown' ? state.pinUnknownStreak + 1 : 0
  return { aborted: false, verdict: outcome.verdict }
}

/**
 * pin 没被判不可用：按缓存收敛 provider；只有实测可用才算恢复。
 * 仅超时一轮就清掉退避的话，紧随其后的 400 会绕过退避立刻再扫一遍。
 */
async function keepPin(round: AgyRound, pinVerdict: AgyProbeVerdict | null): Promise<void> {
  const { state } = round
  const ordered = await convergeAgyProvider(round.proxies, round.regionPriority, round.cache)
  await selectAgyNode(ordered, round.pinName)
  if (pinVerdict !== 'usable') {
    return
  }
  clearAgyRepairBackoff(state)
  if (state.phase !== 'healthy') {
    await appendAppLog(
      `[SparkleAgyProbe]: pin ${round.pinName ?? 'n/a'} healthy again, pool=${ordered.length}\n`
    )
    state.phase = 'healthy'
  }
}

/** 同一时刻只允许一轮在跑（探测会占用官方账号配额与隐藏探测通道）；异常只记日志，不外抛。 */
async function runExclusiveRound(run: (state: AgyState) => Promise<void>): Promise<void> {
  if (probeInFlight) {
    return
  }
  probeInFlight = true
  try {
    const handle = await openAgyState()
    try {
      await run(handle.state)
    } finally {
      await handle
        .commit()
        .catch((error) =>
          appendAppLog(`[SparkleAgyProbe]: state save failed, ${describeError(error)}\n`)
        )
    }
  } catch (error) {
    await appendAppLog(`[SparkleAgyProbe]: error=${describeError(error)}\n`)
  } finally {
    probeInFlight = false
  }
}

/** 定时入口：pin 就地复测，判定不可用才进入修复扫描。 */
export async function bootstrapSparkleAgyProvider(): Promise<void> {
  await runExclusiveRound(async (state) => {
    const round = await openRound(state)
    if (!round) {
      return
    }
    const pin = await checkPin(round)
    if (pin.aborted) {
      return
    }
    if (!shouldRepairAgyPin({ pinVerdict: pin.verdict, unknownStreak: state.pinUnknownStreak })) {
      await keepPin(round, pin.verdict)
      return
    }
    await repairPin(round, `verdict=${pin.verdict ?? 'none'} streak=${state.pinUnknownStreak}`)
  })
}

/**
 * 被动入口：生产流量在 agy 出口上大面积拨号失败。pin 的就地复测按固定间隔采样、对抖动节点还会随机通过，
 * 所以越过它直接进入修复扫描；互斥与全灭退避照常生效，不增加任何常规探测。
 */
export async function repairSparkleAgyPinOnDialFailures(): Promise<void> {
  await runExclusiveRound(async (state) => {
    const round = await openRound(state)
    if (round) {
      await repairPin(round, 'trigger=dial-failures')
    }
  })
}

let agyProbeTimer: NodeJS.Timeout | undefined

/**
 * 启动定时巡检，并订阅内核告警以便在拨号失败风暴时不等下一轮；重复调用无副作用。
 * 定时巡检与告警触发的修复都先问开关：agy 组被关闭时整轮跳过，不发任何探测请求。
 */
export function startSparkleAgyProbeLoop(isEnabled: DedicatedGroupGate): void {
  if (agyProbeTimer) {
    return
  }
  agyProbeTimer = setInterval(() => {
    runWhenEnabled(isEnabled, bootstrapSparkleAgyProvider).catch(() => undefined)
  }, AGY_PIN_CHECK_INTERVAL_MS)
  agyProbeTimer.unref()

  const dialFailureWatch = createAgyDialFailureWatch(AGY_DEDICATED_GROUP_NAME)
  subscribeMihomoAlerts((log) => {
    if (dialFailureWatch.observe(log, Date.now())) {
      runWhenEnabled(isEnabled, repairSparkleAgyPinOnDialFailures).catch(() => undefined)
    }
  })
}
