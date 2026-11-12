// [INPUT] `🎯 agy 专用` 组（mihomo）· `sparkle-agy` provider 文件 · agy CLI 探测 · 探测缓存
// [OUTPUT] probeSingleNode · convergeAgyProvider · selectAgyNode
// [POS] 对 agy 组的全部操作：归因安全的单节点探测、provider 收敛、切换选择。
// 归因约束：agy 每次探测都是新进程，切组后由 mihomo 的新连接接管；仍保留 mihomoCloseConnections 清掉旧连接。

import { performance } from 'node:perf_hooks'
import { writeFile } from 'fs/promises'
import path from 'path'
import { profilesDir } from '../utils/dirs'
import { stringifyYaml } from '../utils/yaml'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import {
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoGroupDetail,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { requestNativeAgy } from './sparkleAgyCli'
import { recordAgyAttempt } from './sparkleAgyProbeSnapshot'
import {
  AGY_NODE_PROVIDER_FILENAME,
  AGY_NODE_PROVIDER_ID,
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
    const now = String(detail?.now ?? '').trim()
    return now.length > 0 ? now : null
  } catch {
    return null
  }
}

/** 切组之前的连接全部走旧出口，切完必须清掉，否则新请求可能复用旧出口。 */
async function closeAgyConnections(): Promise<void> {
  await mihomoCloseConnections(AGY_DEDICATED_GROUP_NAME)
}

/** 模块内记录上一次观察到的选择：外部（订阅刷新后 provider 收敛）改过选择也必须断一次旧连接。 */
let lastObservedSelection: string | null = null

function rememberSelection(node: string | null): void {
  lastObservedSelection = node
}

/**
 * 单节点探测。归因保证：
 * 1. 组选择被外部改动过 → 先断旧连接；
 * 2. 目标不是当前选择 → 切组后立刻断连接；
 * 3. 断连接失败 → 返回 unknown，绝不把结果写到该节点头上。
 */
export async function probeSingleNode(node: string, timeoutMs: number): Promise<AgyAuditOutcome> {
  try {
    const selection = await currentAgySelection()
    if (selection === null) {
      return { verdict: 'unknown', rttMs: 0, fatal: false }
    }
    if (selection !== lastObservedSelection) {
      await closeAgyConnections()
      rememberSelection(selection)
    }
    if (selection !== node) {
      const switched = await mihomoChangeProxy(AGY_DEDICATED_GROUP_NAME, node).catch(() => false)
      if (!switched) {
        // 典型原因：该节点已被订阅移除，或组尚未生成 —— 跳过它，不要因为单个节点中止整轮巡检。
        return { verdict: 'unknown', rttMs: 0, fatal: false }
      }
      await closeAgyConnections()
      rememberSelection(node)
    }
  } catch {
    return { verdict: 'unknown', rttMs: 0, fatal: false }
  }

  const startMs = performance.now()
  const response = await requestNativeAgy(timeoutMs)
  const rttMs = Math.max(1, Math.round(performance.now() - startMs))

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

function providerNames(documentProxies: readonly AgyProxyRecord[]): string[] {
  return documentProxies
    .map((proxy) => String(proxy.name ?? '').trim())
    .filter((name) => name.length > 0)
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
    rememberSelection(after)
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
  rememberSelection(target)
  await closeAgyConnections().catch(() => undefined)
  return target
}
