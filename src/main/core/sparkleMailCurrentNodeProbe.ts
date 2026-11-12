// [INPUT] sparkleMailProbe::loadCurrentMailProxies/loadSparkleMailProbeCache/writeSparkleMailProviderFromCache/ensureMailProviderReloaded (POS: 邮件 provider 同步) ·
//         sparkleMailPortProbe::probeSingleNodeMailPorts (POS: 单节点 993/465 TLS Banner 校验) ·
//         sparkleMailActivityCore::connectionChainsIncludeGroup/isMailGroupRecentlyActive (POS: 邮件活动判定) ·
//         mailTrafficRuleInjection::MAIL_TRAFFIC_RULE_BASES (POS: 邮件域名分流规则) ·
//         mihomoApi::mihomoGetConnections/mihomoGroupDetail/subscribeMihomoLogs (POS: mihomo 控制器访问层)
// [OUTPUT] startSparkleMailCurrentNodeProbeLoop
// [POS] 邮件组当前节点的按需保护：只在邮件最近被使用时复测 993/465（拨号失败后 30s 提前触发、5 分钟兜底）；失败让 provider 剔除节点并触发自动切换，未使用时不探测。

import { getAppConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { MAIL_DEDICATED_GROUP_NAME, MAIL_PROBE_HIDDEN_GROUP_NAME } from './cursorProxyGroup'
import { MAIL_TRAFFIC_RULE_BASES } from './mailTrafficRuleInjection'
import { mihomoGetConnections, mihomoGroupDetail, subscribeMihomoLogs } from './mihomoApi'
import { isMihomoApiResourceNotFoundError } from './mihomoProxyDelayCore'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  connectionChainsIncludeGroup,
  isMailGroupRecentlyActive,
  nextMailActivityAtMs
} from './sparkleMailActivityCore'
import {
  ensureMailProviderReloaded,
  loadCurrentMailProxies,
  loadSparkleMailProbeCache,
  runSparkleMailProbeExclusive,
  saveSparkleMailProbeCache,
  writeSparkleMailProviderFromCache
} from './sparkleMailProbe'
import { probeSingleNodeMailPorts } from './sparkleMailPortProbe'

const CURRENT_NODE_RECHECK_INTERVAL_MS = 5 * 60 * 1000
/** 邮件活动日志后延迟触发一次当前节点复测；避免 Mail.app 连续重连时形成探测风暴。 */
const ACTIVITY_PROBE_DELAY_MS = 30 * 1000

/** 邮件分流规则里的目的域名；日志里出现任一即视为邮件活动（隐藏探测通道自己的日志除外）。 */
const MAIL_ACTIVITY_HOST_MARKERS = MAIL_TRAFFIC_RULE_BASES.map((rule) => rule.split(',')[1])

let lastMailActivityAtMs = 0
let currentCheckQueued = false
let currentNodeTimer: NodeJS.Timeout | undefined
let activityProbeTimer: NodeJS.Timeout | undefined

/** 内核日志里出现邮件组或邮件收发域名即视为邮件被使用（成功/失败都触发，覆盖长时间空闲后的第一次连接尝试）。 */
function noteMailLogActivity(log: ControllerLog): void {
  const payload = log.payload ?? ''
  if (payload.includes(MAIL_PROBE_HIDDEN_GROUP_NAME)) {
    return
  }
  if (
    payload.includes(MAIL_DEDICATED_GROUP_NAME) ||
    MAIL_ACTIVITY_HOST_MARKERS.some((host) => payload.includes(host))
  ) {
    lastMailActivityAtMs = Date.now()
    // 成功连接不用立刻复测（5 分钟周期兜底）；失败/超时日志才提前触发一次。
    if (payload.includes('dial ') || payload.includes('error')) {
      scheduleActivityProbe()
    }
  }
}

function scheduleActivityProbe(): void {
  if (activityProbeTimer) {
    return
  }
  activityProbeTimer = setTimeout(() => {
    activityProbeTimer = undefined
    scheduleCurrentNodeCheck()
  }, ACTIVITY_PROBE_DELAY_MS)
  activityProbeTimer.unref()
}

async function checkCurrentMailNode(): Promise<void> {
  try {
    const connections = await mihomoGetConnections().catch(() => undefined)
    const activeNow = connectionChainsIncludeGroup(connections, MAIL_DEDICATED_GROUP_NAME)
    lastMailActivityAtMs = nextMailActivityAtMs(lastMailActivityAtMs, activeNow, Date.now())
    if (!isMailGroupRecentlyActive(lastMailActivityAtMs, Date.now())) {
      return
    }

    const group = await mihomoGroupDetail(MAIL_DEDICATED_GROUP_NAME)
    const nodeName = group.now?.trim()
    if (!nodeName || !group.all.includes(nodeName)) {
      return
    }

    const proxies = await loadCurrentMailProxies()
    const currentProxy = proxies.find((proxy) => String(proxy.name ?? '').trim() === nodeName)
    if (!currentProxy) {
      return
    }

    const fingerprint = computeProxyNodeFingerprint(currentProxy)
    const cache = await loadSparkleMailProbeCache()
    const previous = cache.get(fingerprint)
    const result = await probeSingleNodeMailPorts(nodeName)
    cache.set(fingerprint, {
      alive: result.alive,
      rttMs: result.rttMs,
      checkedAt: Date.now()
    })
    await saveSparkleMailProbeCache(cache)

    // 存活状态没变化时不重写 provider 文件；但仍重试上一次失败的热重载。
    if (previous?.alive === result.alive) {
      await ensureMailProviderReloaded()
      return
    }

    const { proxySwitchPriority = [] } = await getAppConfig()
    const regionPriority = resolveEffectiveRegionPriority(proxySwitchPriority)
    const { count } = await writeSparkleMailProviderFromCache(proxies, regionPriority, cache)
    await ensureMailProviderReloaded()
    await appendAppLog(
      `[SparkleMailProbe]: current node ${nodeName} ${result.alive ? 'recovered' : 'dead'} (993/465) active_pool=${count}\n`
    )
  } catch (error) {
    if (isMihomoApiResourceNotFoundError(error)) {
      return
    }
    await appendAppLog(
      `[SparkleMailProbe]: current node check error=${error instanceof Error ? error.message : String(error)}\n`
    )
  }
}

function scheduleCurrentNodeCheck(): void {
  if (currentCheckQueued) {
    return
  }
  currentCheckQueued = true
  void runSparkleMailProbeExclusive(checkCurrentMailNode)
    .catch(() => undefined)
    .finally(() => {
      currentCheckQueued = false
    })
}

/** 幂等：5 分钟检查一次是否有邮件活动；没有活动时本轮 0 次端口探测。 */
export function startSparkleMailCurrentNodeProbeLoop(): void {
  if (currentNodeTimer) {
    return
  }
  subscribeMihomoLogs(noteMailLogActivity)
  currentNodeTimer = setInterval(scheduleCurrentNodeCheck, CURRENT_NODE_RECHECK_INTERVAL_MS)
  currentNodeTimer.unref()
}
