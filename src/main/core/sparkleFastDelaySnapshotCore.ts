// [INPUT] sparkleFastProviderCore::NodeDelayMap (POS: sparkle-fast provider 文件生成与延迟类型) · sparkle-fast-delays.json
// [OUTPUT] buildProviderFingerprint · snapshotCoverage · hasSufficientSnapshotCoverage · parse/serializeSparkleFastDelaySnapshot
// [POS] 延迟快照的纯数据层：只有节点配置指纹一致且覆盖率足够的成功样本才可用于排序。
// 指纹忽略 provider 运行时字段并做稳定序列化，文件重排不会误判为配置变化；SNI/端口/服务器变化会改变指纹。

import { createHash } from 'crypto'
import type { NodeDelayMap } from './sparkleFastProviderCore'

export const SPARKLE_FAST_DELAY_SNAPSHOT_VERSION = 2
/** 至少 80% 的当前 provider 节点有可解析样本，才允许跳过启动补测。 */
export const MIN_PREFERRED_PROBE_COVERAGE_RATIO = 0.8

export type ProxyRecord = Record<string, unknown>

/** mihomo provider API 注入的运行时字段，不属于订阅配置，不能参与指纹。 */
const RUNTIME_ONLY_PROXY_KEYS = new Set([
  'alive',
  'dialer-proxy',
  'extra',
  'history',
  'id',
  'interface',
  'mptcp',
  'provider-name',
  'routing-mark',
  'smux',
  'tfo',
  'uot',
  'xudp'
])

export interface SnapshotCoverage {
  covered: number
  total: number
  ratio: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(value[key])
    }
    return result
  }
  return value
}

function canonicalProxy(proxy: ProxyRecord): ProxyRecord {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(proxy).sort()) {
    if (RUNTIME_ONLY_PROXY_KEYS.has(key)) {
      continue
    }
    result[key] = canonicalize(proxy[key])
  }
  return result
}

/** provider 配置指纹：节点顺序无关，节点配置（含 SNI/端口/服务器）变化即失效。 */
export function buildProviderFingerprint(proxies: readonly ProxyRecord[]): string {
  const canonical = proxies.map(canonicalProxy).sort((a, b) => {
    const byName = String(a.name ?? '').localeCompare(String(b.name ?? ''))
    return byName === 0 ? JSON.stringify(a).localeCompare(JSON.stringify(b)) : byName
  })
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** 只统计「当前 provider 中仍存在且快照里有样本」的节点，避免陈旧节点名虚增覆盖率。 */
export function snapshotCoverage(
  currentProxies: readonly ProxyRecord[],
  samples: ReadonlyMap<string, number>
): SnapshotCoverage {
  const total = currentProxies.length
  if (total === 0) {
    return { covered: 0, total: 0, ratio: 0 }
  }
  let covered = 0
  for (const proxy of currentProxies) {
    if (typeof proxy.name === 'string' && samples.has(proxy.name)) {
      covered += 1
    }
  }
  return { covered, total, ratio: covered / total }
}

export function hasSufficientSnapshotCoverage(
  currentProxies: readonly ProxyRecord[],
  samples: ReadonlyMap<string, number>,
  minimumRatio: number = MIN_PREFERRED_PROBE_COVERAGE_RATIO
): boolean {
  const coverage = snapshotCoverage(currentProxies, samples)
  return coverage.total > 0 && coverage.ratio >= minimumRatio
}

/**
 * 解析延迟快照。旧版裸 `{name: delay}`、版本不匹配、配置指纹不匹配均视为空快照，
 * 迫使启动阶段重新探测，避免把旧 SNI/旧端口的延迟套到新配置上。
 */
export function parseSparkleFastDelaySnapshot(
  raw: string,
  currentProxies: readonly ProxyRecord[]
): NodeDelayMap {
  const samples = new Map<string, number>()
  if (currentProxies.length === 0) {
    return samples
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return samples
  }
  if (!isRecord(parsed) || parsed.version !== SPARKLE_FAST_DELAY_SNAPSHOT_VERSION) {
    return samples
  }
  if (
    typeof parsed.providerFingerprint !== 'string' ||
    parsed.providerFingerprint !== buildProviderFingerprint(currentProxies)
  ) {
    return samples
  }
  if (!isRecord(parsed.samples)) {
    return samples
  }

  const availableNames = new Set(
    currentProxies
      .map((proxy) => proxy.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
  )
  for (const [name, delay] of Object.entries(parsed.samples)) {
    if (
      availableNames.has(name) &&
      typeof delay === 'number' &&
      Number.isFinite(delay) &&
      delay > 0
    ) {
      samples.set(name, delay)
    }
  }
  return samples
}

/** 写盘前过滤陈旧/非法样本，保持快照与当前 provider 成员一致。 */
export function serializeSparkleFastDelaySnapshot(
  currentProxies: readonly ProxyRecord[],
  samples: ReadonlyMap<string, number>
): string {
  const availableNames = new Set(
    currentProxies
      .map((proxy) => proxy.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
  )
  const filtered: Record<string, number> = {}
  for (const [name, delay] of samples) {
    if (availableNames.has(name) && Number.isFinite(delay) && delay > 0) {
      filtered[name] = delay
    }
  }
  return JSON.stringify({
    version: SPARKLE_FAST_DELAY_SNAPSHOT_VERSION,
    providerFingerprint: buildProviderFingerprint(currentProxies),
    samples: filtered
  })
}
