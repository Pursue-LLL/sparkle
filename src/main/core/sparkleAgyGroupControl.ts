// [INPUT] `🎯 agy 专用` 组（mihomo）· `sparkle-agy` provider 文件 · agy CLI 探测 · 探测缓存 ·
//         cursorProxyGroup::AGY_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         localProbeChannel::withLocalProbeChannelLock/LOCAL_PROBE_PROXY_URL (POS: 本地隐藏探测通道) ·
//         mihomoApi::mihomoChangeProxy/mihomoCloseConnections/mihomoGroupDetail/mihomoUpdateProxyProviders (POS: mihomo 控制器访问层) ·
//         sparkleAgyCli::requestNativeAgy/NativeAgyResponse (POS: 官方 agy CLI 请求) ·
//         sparkleAgyProbeCore::AgyAuditOutcome (POS: agy 巡检状态机) ·
//         sparkleAgyProbeSnapshot::recordAgyAttempt (POS: agy 展示快照) ·
//         sparkleAgyProviderCore::AGY_NODE_PROVIDER_FILENAME/AGY_NODE_PROVIDER_ID/agyProxyName/buildSparkleAgyProviderDocument… (POS: agy provider 与分组配置) ·
//         utils/dirs::profilesDir (POS: 应用目录与路径常量) ·
//         utils/yaml::stringifyYaml (POS: YAML 解析与序列化)
// [OUTPUT] probeSingleNode · convergeAgyProvider · selectAgyNode
// [POS] 对 agy 的全部操作：归因安全且不碰线上出口的单节点探测、provider 收敛、切换选择。
// 探测只走本地隐藏探测通道，`🎯 agy 专用` 组与用户的连接在探测期间纹丝不动；只有 provider 收敛与切换选择才会改动线上出口，
// 改动后立即断掉旧连接，否则新请求可能复用旧出口。

import { performance } from 'node:perf_hooks'
import { writeFile } from 'fs/promises'
import path from 'path'
import { profilesDir } from '../utils/dirs'
import { stringifyYaml } from '../utils/yaml'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { LOCAL_PROBE_PROXY_URL, withLocalProbeChannelLock } from './localProbeChannel'
import {
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoGroupDetail,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { requestNativeAgy, type NativeAgyResponse } from './sparkleAgyCli'
import { recordAgyAttempt } from './sparkleAgyProbeSnapshot'
import {
  AGY_NODE_PROVIDER_FILENAME,
  AGY_NODE_PROVIDER_ID,
  agyProxyName,
  buildSparkleAgyProviderDocument,
  classifyAgyProbeResponse,
  type AgyNodeProbeCache,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'
import type { AgyAuditOutcome } from './sparkleAgyProbeCore'

/** 组当前实际生效的节点；组尚未生成时返回 null（此时任何探测结论都不可归因）。 */
async function currentAgySelection(): Promise<string | null> {
  try {
    const detail = await mihomoGroupDetail(AGY_DEDICATED_GROUP_NAME)
    return String(detail?.now ?? '').trim() || null
  } catch {
    return null
  }
}

/** 切组之前的连接全部走旧出口，切完必须清掉，否则新请求可能复用旧出口。 */
async function closeAgyConnections(): Promise<void> {
  await mihomoCloseConnections(AGY_DEDICATED_GROUP_NAME)
}

/**
 * 单节点探测。归因保证：探测进程的全部连接经本地隐藏探测通道出站，通道在持锁期间固定在 `node` 上，
 * 所以结论只可能属于这个节点；`🎯 agy 专用` 组与用户的连接全程不动。
 * 通道切不到该节点（订阅已移除它、控制器不可用）时返回 unknown：跳过它，不要因为单个节点中止整轮巡检。
 */
export async function probeSingleNode(node: string, timeoutMs: number): Promise<AgyAuditOutcome> {
  let measured: { response: NativeAgyResponse; rttMs: number }
  try {
    measured = await withLocalProbeChannelLock(node, async () => {
      const startMs = performance.now()
      const response = await requestNativeAgy(timeoutMs, LOCAL_PROBE_PROXY_URL)
      return { response, rttMs: Math.max(1, Math.round(performance.now() - startMs)) }
    })
  } catch {
    return { verdict: 'unknown', rttMs: 0, fatal: false }
  }
  const { response, rttMs } = measured

  if (response.kind === 'unreachable') {
    recordAgyAttempt(node, 'failed', 'agy CLI 无法启动')
    return { verdict: 'unknown', rttMs: 0, fatal: true }
  }
  if (response.kind === 'timeout') {
    recordAgyAttempt(node, 'failed', '超时')
    return { verdict: 'unknown', rttMs, fatal: false }
  }
  const verdict = classifyAgyProbeResponse(response.status, response.body)
  if (verdict === 'usable') {
    recordAgyAttempt(node, 'usable')
  } else if (verdict === 'unusable') {
    recordAgyAttempt(node, 'unusable', '地区不支持')
  } else {
    recordAgyAttempt(node, 'failed', `HTTP ${response.status}`)
  }
  return { verdict, rttMs, fatal: verdict === 'fatal' }
}

/** provider 文档里的节点一定有名字：没有名字的节点在生成文档时就被排除了。 */
function providerNames(documentProxies: readonly AgyProxyRecord[]): string[] {
  return documentProxies.map(agyProxyName)
}

function sameMemberSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  const set = new Set(right)
  return left.every((name) => set.has(name))
}

/** 重载 provider 时 mihomo 可能因成员消失改写组选择；选择一变就必须断旧连接。 */
async function reloadAgyProvider(): Promise<void> {
  const before = await currentAgySelection()
  await mihomoUpdateProxyProviders(AGY_NODE_PROVIDER_ID)
  const after = await currentAgySelection()
  if (after !== before) {
    await closeAgyConnections().catch(() => undefined)
  }
}

/**
 * 把 `sparkle-agy` provider 收敛到目标集合：
 * 成员集合没变就不写盘、不热重载 —— 避免每轮都打断 provider（重载可能重置组选择）。
 */
export async function convergeAgyProvider(
  proxies: readonly AgyProxyRecord[],
  regionPriority: readonly string[],
  probeCache: AgyNodeProbeCache | undefined
): Promise<string[]> {
  const document = buildSparkleAgyProviderDocument({ proxies, regionPriority, probeCache })
  const names = providerNames(document.proxies)
  if (names.length === 0) {
    return []
  }

  const detail = await mihomoGroupDetail(AGY_DEDICATED_GROUP_NAME).catch(() => undefined)
  if (sameMemberSet(names, detail?.all ?? [])) {
    return names
  }

  await writeFile(
    path.join(profilesDir(), AGY_NODE_PROVIDER_FILENAME),
    stringifyYaml(document),
    'utf8'
  )
  await reloadAgyProvider()
  return names
}

/**
 * 切换选择并让旧出口立即失效；当前已经是目标节点时不做任何动作。
 * 返回组最终所处的节点：切换失败时是原来的节点，候选池为空时是 null。
 */
export async function selectAgyNode(
  ordered: readonly string[],
  preferred?: string | null
): Promise<string | null> {
  if (ordered.length === 0) {
    return null
  }
  const target = preferred && ordered.includes(preferred) ? preferred : ordered[0]
  const before = await currentAgySelection()
  if (before === target) {
    return target
  }
  const switched = await mihomoChangeProxy(AGY_DEDICATED_GROUP_NAME, target).catch(() => false)
  if (!switched) {
    return before
  }
  await closeAgyConnections().catch(() => undefined)
  return target
}
