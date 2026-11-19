// [INPUT] 当前订阅节点 · 探测缓存 · agy 组当前选择 · 巡检状态 ·
//         config::getAppConfig/getProfile/getProfileConfig (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         cursorProxyGroup::AGY_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         mihomoApi::mihomoGroupDetail (POS: mihomo 控制器访问层) ·
//         sparkleAgyGroupControl::selectAgyNode (POS: agy 组操作) ·
//         provider::extractProxies (POS: 订阅节点 → provider 文件) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         regionPriority::resolveEffectiveRegionPriority (POS: 地区优先级与地区匹配) ·
//         sparkleAgyProbeCache::loadSparkleAgyProbeCache (POS: agy 探测缓存读写) ·
//         sparkleAgyProbeSnapshot::syncAgyProbeSnapshot (POS: agy 展示快照) ·
//         sparkleAgyProviderCore::agyProxyName/AgyNodeProbeRecord/AgyProxyRecord (POS: agy provider 与分组配置) ·
//         sparkleAgyReputation::flagAgyNode (POS: agy 节点被拒记忆) ·
//         sparkleAgyState::AgyState (POS: agy 巡检状态持久化)
// [OUTPUT] AgyRound · openRound · countUsable · flagPin · selectPin
// [POS] 一轮巡检的共用上下文：订阅里的候选节点、探测缓存、巡检状态与当前 pin；
// 没有可巡检的对象（未选订阅 / 订阅无节点 / 组未生成）时没有上下文，整轮跳过。
// pin 的上任时间在这里维护：每轮开头对齐观察到的选择，自己切换时记下落点；节点一变就重新计时。

import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { mihomoGroupDetail } from './mihomoApi'
import { extractProxies } from './provider'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { resolveEffectiveRegionPriority } from './regionPriority'
import { selectAgyNode } from './sparkleAgyGroupControl'
import { loadSparkleAgyProbeCache } from './sparkleAgyProbeCache'
import { syncAgyProbeSnapshot } from './sparkleAgyProbeSnapshot'
import {
  agyProxyName,
  type AgyNodeProbeRecord,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'
import { flagAgyNode } from './sparkleAgyReputation'
import type { AgyState } from './sparkleAgyState'

export interface AgyRound {
  /** 本轮开始时的订阅：修复扫描跨了几分钟，写 provider 前要确认订阅没被切走。 */
  profileName: string
  proxies: AgyProxyRecord[]
  regionPriority: string[]
  cache: Map<string, AgyNodeProbeRecord>
  pinName: string | null
  pinProxy: AgyProxyRecord | undefined
  state: AgyState
}

/** 把观察到（或刚切到）的 pin 对齐到状态：节点变了就是新的上任，重新计时。 */
function trackPin(state: AgyState, pinName: string | null, nowMs: number): void {
  if ((state.pin?.name ?? null) !== pinName) {
    state.pin = pinName === null ? null : { name: pinName, sinceMs: nowMs }
  }
}

/** 没有可巡检的对象时返回 undefined。 */
export async function openRound(state: AgyState): Promise<AgyRound | undefined> {
  const { current } = await getProfileConfig()
  if (!current || current === 'default') {
    return undefined
  }
  const profile = await getProfile(current)
  const proxies = extractProxies(profile) as AgyProxyRecord[]
  if (proxies.length === 0) {
    return undefined
  }

  const { proxySwitchPriority = [] } = await getAppConfig()
  const regionPriority = resolveEffectiveRegionPriority(proxySwitchPriority)
  const cache = await loadSparkleAgyProbeCache()
  syncAgyProbeSnapshot(cache, proxies)

  // 组未生成（无候选节点）时既没有可探测的出口，也不能热重载一个不存在的 provider。
  const group = await mihomoGroupDetail(AGY_DEDICATED_GROUP_NAME).catch(() => undefined)
  if (!group) {
    return undefined
  }

  const pinName = String(group.now ?? '').trim() || null
  trackPin(state, pinName, Date.now())
  const pinProxy = proxies.find((proxy) => agyProxyName(proxy) === pinName)
  return { profileName: current, proxies, regionPriority, cache, pinName, pinProxy, state }
}

export function countUsable(round: AgyRound): number {
  return round.proxies.filter(
    (proxy) => round.cache.get(computeProxyNodeFingerprint(proxy))?.usable === true
  ).length
}

/** 把当前 pin 记入被拒记忆；pin 不在订阅里时没有可记的对象。 */
export function flagPin(round: AgyRound, nowMs: number): void {
  if (round.pinProxy) {
    flagAgyNode(round.state.flags, computeProxyNodeFingerprint(round.pinProxy), nowMs)
  }
}

/** 切换（或保持）组选择，并把落点记为 pin；候选池为空、没有落点时不动记录。 */
export async function selectPin(
  round: AgyRound,
  ordered: readonly string[],
  preferred: string | null
): Promise<string | null> {
  const selected = await selectAgyNode(ordered, preferred)
  if (selected !== null) {
    trackPin(round.state, selected, Date.now())
  }
  return selected
}
