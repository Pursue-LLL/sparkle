// [INPUT] mihomo provider 列表 · Gemini 探测目标（与 `自动选择` 同源）
// [OUTPUT] probeProviderLeavesGently · verifyUnconfirmedFailures
// [POS] 冷启动阶段的低并发拨测：逐点探测并复测「超时/未测」节点，让界面看到的是确认过的结论而非批量并发的误报。

import { appendAppLog } from '../utils/log'
import {
  AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
  AUTO_SELECT_GEMINI_PROBE_URL
} from './defaultAutoSwitchProxy'
import { mihomoProviderLeafDelay, mihomoProxyProviders } from './mihomoApi'
import { listUnconfirmedLeafNames, mapWithConcurrency } from './providerLeafProbeCore'

const PROBE_CONCURRENCY = 4
/** 复测阶段的总时长上限：超出后剩余节点保持现状，由 mihomo 周期体检接手。 */
const VERIFY_BUDGET_MS = 150_000
const INLINE_GROUP_VEHICLE_TYPE = 'Compatible'

async function probeLeaves(providerName: string, names: readonly string[], deadlineMs: number): Promise<void> {
  await mapWithConcurrency(names, PROBE_CONCURRENCY, async (name) => {
    if (Date.now() >= deadlineMs) {
      return
    }
    await mihomoProviderLeafDelay(
      providerName,
      name,
      AUTO_SELECT_GEMINI_PROBE_URL,
      AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS
    )
  })
}

/** 逐点探测整个 provider（代替 provider 级并发体检）；返回探测的节点数。 */
export async function probeProviderLeavesGently(providerName: string): Promise<number> {
  const leaves = (await mihomoProxyProviders()).providers[providerName]?.proxies ?? []
  await probeLeaves(
    providerName,
    leaves.map((leaf) => leaf.name),
    Number.POSITIVE_INFINITY
  )
  return leaves.length
}

/**
 * 复测所有非内联组 provider 里仍为「超时/未测」的节点。
 * 结果由 mihomo 写入各节点 history，界面随之更新；返回复测的节点数。
 */
export async function verifyUnconfirmedFailures(): Promise<number> {
  const deadlineMs = Date.now() + VERIFY_BUDGET_MS
  const { providers } = await mihomoProxyProviders()
  let probed = 0
  for (const [providerName, provider] of Object.entries(providers)) {
    if (provider.vehicleType === INLINE_GROUP_VEHICLE_TYPE) {
      continue
    }
    const names = listUnconfirmedLeafNames(provider.proxies ?? [], AUTO_SELECT_GEMINI_PROBE_URL)
    await probeLeaves(providerName, names, deadlineMs)
    probed += names.length
  }
  await appendAppLog(`[ProviderLeafProbe]: verified unconfirmed failures probed=${probed}\n`)
  return probed
}
