// [INPUT] `grok 专用` 组（mihomo）· provider 成员 · 探测缓存 ·
//         cursorProxyGroup::GROK_DEDICATED_GROUP_NAME/GROK_DELAY_TEST_URL (POS: Sparkle 分组名常量与判定谓词) ·
//         mihomoApi::mihomoChangeProxy/mihomoCloseConnections/mihomoGroupDelay/mihomoGroupDetail (POS: mihomo 控制器访问层) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleGrokProviderCore::grokProxyName/GrokNodeProbeRecord/GrokProxyRecord (POS: grok provider 与快照) ·
//         sparkleGrokProviderSync::readGrokProviderMembers (POS: grok provider 落盘与热重载) ·
//         sparkleGrokRoutedCheck::ROUTED_CHECK_TIMEOUT_MS (POS: grok 真实请求判定口径) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] currentGrokNode · switchGrokNode · refreshGrokPoolIfDue
// [POS] 对 grok 组的操作：读当前节点、切换并断开旧连接、每 5 分钟用非侵入式 group-delay(expected=200) 刷新池内延迟。

import { appendAppLog } from '../utils/log'
import { GROK_DEDICATED_GROUP_NAME, GROK_DELAY_TEST_URL } from './cursorProxyGroup'
import {
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoGroupDelay,
  mihomoGroupDetail
} from './mihomoApi'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { readGrokProviderMembers } from './sparkleGrokProviderSync'
import {
  grokProxyName,
  type GrokNodeProbeRecord,
  type GrokProxyRecord
} from './sparkleGrokProviderCore'
import { ROUTED_CHECK_TIMEOUT_MS } from './sparkleGrokRoutedCheck'

/** 池内全部成员的延迟刷新周期：非侵入式 group-delay，不切组、不断连。 */
const POOL_REFRESH_INTERVAL_MS = 5 * 60 * 1000

/** 上次池内全量延迟刷新时间；避免每分钟重复扫池内全部节点。 */
let lastPoolRefreshAt = 0

export async function currentGrokNode(): Promise<string | null> {
  try {
    const detail = await mihomoGroupDetail(GROK_DEDICATED_GROUP_NAME)
    return String(detail?.now ?? '').trim() || null
  } catch {
    return null
  }
}

export async function switchGrokNode(node: string): Promise<boolean> {
  const switched = await mihomoChangeProxy(GROK_DEDICATED_GROUP_NAME, node).catch(() => false)
  if (!switched) {
    return false
  }
  await mihomoCloseConnections(GROK_DEDICATED_GROUP_NAME).catch(() => undefined)
  return true
}

/**
 * 非侵入式全量刷新：用 mihomo group-delay(expected=200) 测当前 provider 的全部成员。
 * 不切换选择、不关闭连接，只更新内存里的缓存（本轮结束时统一落盘并重建展示快照）；
 * 当前节点跳过——它的 60 秒 HEAD 复核更权威。
 */
async function refreshGrokPoolLatency(
  proxies: readonly GrokProxyRecord[],
  cache: Map<string, GrokNodeProbeRecord>,
  currentName: string | null
): Promise<void> {
  const members = new Set(await readGrokProviderMembers())
  if (members.size === 0) {
    return
  }

  const startedAt = Date.now()
  lastPoolRefreshAt = startedAt
  let delays: Record<string, number>
  try {
    delays = await mihomoGroupDelay(GROK_DEDICATED_GROUP_NAME, GROK_DELAY_TEST_URL, {
      timeoutMs: ROUTED_CHECK_TIMEOUT_MS,
      expectedStatus: '200'
    })
  } catch (error) {
    await appendAppLog(
      `[SparkleGrokProbe]: pool refresh failed err=${
        error instanceof Error ? error.message : String(error)
      }\n`
    )
    return
  }

  const byName = new Map(proxies.map((proxy) => [grokProxyName(proxy), proxy]))
  const now = Date.now()
  let ok = 0
  for (const name of members) {
    const proxy = byName.get(name)
    if (!proxy || name === currentName) {
      continue
    }
    const delay = Number(delays?.[name])
    if (Number.isFinite(delay) && delay > 0) {
      ok += 1
      cache.set(computeProxyNodeFingerprint(proxy), {
        alive: true,
        rttMs: delay,
        checkedAt: now,
        status: 200
      })
    } else {
      cache.set(computeProxyNodeFingerprint(proxy), {
        alive: false,
        rttMs: 0,
        checkedAt: now,
        reason: 'group-delay 未通过（超时或 403 挑战）'
      })
    }
  }

  await appendAppLog(
    `[SparkleGrokProbe]: pool refresh members=${members.size} ok=${ok} elapsed=${
      Date.now() - startedAt
    }ms\n`
  )
}

/** 距上次刷新满 5 分钟才刷新；provider 还没有成员时无从刷新，也不占用刷新周期。 */
export async function refreshGrokPoolIfDue(
  proxies: readonly GrokProxyRecord[],
  cache: Map<string, GrokNodeProbeRecord>
): Promise<void> {
  if (Date.now() - lastPoolRefreshAt < POOL_REFRESH_INTERVAL_MS) {
    return
  }
  await refreshGrokPoolLatency(proxies, cache, await currentGrokNode())
}
