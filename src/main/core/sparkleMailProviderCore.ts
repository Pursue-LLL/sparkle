// [INPUT] 当前订阅节点 · 地区优先级 · 真实邮件端口（IMAPS 993 + SMTPS 465）探测缓存
// [OUTPUT] MAIL_NODE_PROVIDER_ID · computeMailNodeFingerprint · orderMailProxies · buildSparkleMailProviderDocument
// [POS] `📧 邮件专用` 的专属 provider 文件生成逻辑：
// 只保留通过了 `imap.gmail.com:993` 与 `smtp.gmail.com:465` 双端口 TLS 握手与 Banner 校验的节点；
// 若首次冷启动尚无已验证节点，则排除已知封禁端口节点与 AnyTLS，并优先将 Hysteria2/VLESS 候选节点排在前面兜底，避免空 provider 报错。

import {
  CURSOR_DEDICATED_DIRECT_PROXY,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_DELAY_TEST_URL,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'
import { isAnyTlsProxyType } from './autoSelectAnyTlsExclusionCore'
import { isBlockedRegionNodeName, nodeMatchesRegion } from './regionPriority'

export const MAIL_NODE_PROVIDER_ID = 'sparkle-mail' as const
export const MAIL_NODE_PROVIDER_FILENAME = 'sparkle-mail-proxies.yaml' as const
export const MAIL_PROBE_LISTENER_NAME = 'sparkle-mail-probe' as const
export const MAIL_PROBE_LISTENER_PORT = 17899 as const

export type MailProxyRecord = Record<string, unknown>

export interface MailNodeProbeRecord {
  alive: boolean
  rttMs: number
  checkedAt: number
}

export type MailNodeProbeCache = ReadonlyMap<string, MailNodeProbeRecord>

function proxyName(proxy: MailProxyRecord): string {
  return String(proxy.name ?? '').trim()
}

function proxyType(proxy: MailProxyRecord): string {
  return String(proxy.type ?? '').trim().toLowerCase()
}

/** 节点唯一指纹：用于持久化缓存 993+465 实测结果，当订阅节点服务器或端口变更时自动失效重测。 */
export function computeMailNodeFingerprint(proxy: MailProxyRecord): string {
  const name = proxyName(proxy)
  const type = proxyType(proxy)
  const server = String(proxy.server ?? '').trim()
  const port = String(proxy.port ?? proxy.ports ?? '').trim()
  return `${name}|${type}|${server}|${port}`
}

/** 冷启动尚未完成首次全量探测时，优先把不封邮件端口的 Hysteria2 / VLESS 直连协议排在前面。 */
export function isPreferredMailCandidateType(proxy: MailProxyRecord): boolean {
  const type = proxyType(proxy)
  return type === 'hysteria2' || type === 'vless'
}

function sortSegmentByRttOrType(
  segment: MailProxyRecord[],
  probeCache?: MailNodeProbeCache
): MailProxyRecord[] {
  return [...segment].sort((a, b) => {
    const recA = probeCache?.get(computeMailNodeFingerprint(a))
    const recB = probeCache?.get(computeMailNodeFingerprint(b))
    const rttA = recA?.alive ? recA.rttMs : Number.POSITIVE_INFINITY
    const rttB = recB?.alive ? recB.rttMs : Number.POSITIVE_INFINITY
    if (rttA !== rttB) {
      return rttA < rttB ? -1 : 1
    }
    const prefA = isPreferredMailCandidateType(a) ? 0 : 1
    const prefB = isPreferredMailCandidateType(b) ? 0 : 1
    return prefA - prefB
  })
}

function orderCandidatesByRegion(
  candidates: MailProxyRecord[],
  regionPriority: readonly string[],
  probeCache?: MailNodeProbeCache
): MailProxyRecord[] {
  const included = new Set<string>()
  const nonHkOrdered: MailProxyRecord[] = []
  const hkFallback: MailProxyRecord[] = []

  const take = (matches: (name: string) => boolean, allowHk: boolean): void => {
    const segment: MailProxyRecord[] = []
    for (const proxy of candidates) {
      const name = proxyName(proxy)
      if (!name || included.has(name) || !matches(name)) {
        continue
      }
      const isHk = isBlockedRegionNodeName(name)
      if (!allowHk && isHk) {
        continue
      }
      included.add(name)
      segment.push(proxy)
    }
    const sorted = sortSegmentByRttOrType(segment, probeCache)
    if (allowHk) {
      hkFallback.push(...sorted)
    } else {
      nonHkOrdered.push(...sorted)
    }
  }

  for (const region of regionPriority) {
    take((name) => nodeMatchesRegion(name, region), false)
  }
  take((name) => !isBlockedRegionNodeName(name), false)
  take((name) => isBlockedRegionNodeName(name), true)

  return [...nonHkOrdered, ...hkFallback]
}

/**
 * 筛选并排序 `📧 邮件专用` 的节点：
 * 1. 永远剔除 AnyTLS；
 * 2. 若 `probeCache` 中已有当前订阅的已验证存活节点（`alive === true`），只保留这些 100% 确认 993+465 双通的节点；
 * 3. 若首次冷启动尚无已验证存活节点，则剔除已知 `alive === false` 的节点，并将 Hysteria2/VLESS 优先排在各地区前面；
 * 4. 极端兜底：绝不返回空数组（除非输入本身无非 AnyTLS 节点），防止 Mihomo 因空 provider 报错。
 */
export function orderMailProxies(
  proxies: MailProxyRecord[],
  regionPriority: readonly string[],
  probeCache?: MailNodeProbeCache
): MailProxyRecord[] {
  const seenNames = new Set<string>()
  const eligible: MailProxyRecord[] = []

  for (const proxy of proxies) {
    const name = proxyName(proxy)
    if (!name || seenNames.has(name) || isAnyTlsProxyType(String(proxy.type ?? ''))) {
      continue
    }
    seenNames.add(name)
    eligible.push(proxy)
  }

  if (eligible.length === 0) {
    return []
  }

  const verifiedAlive = eligible.filter(
    (proxy) => probeCache?.get(computeMailNodeFingerprint(proxy))?.alive === true
  )
  if (verifiedAlive.length > 0) {
    return orderCandidatesByRegion(verifiedAlive, regionPriority, probeCache)
  }

  const notConfirmedDead = eligible.filter(
    (proxy) => probeCache?.get(computeMailNodeFingerprint(proxy))?.alive !== false
  )
  const fallbackPool = notConfirmedDead.length > 0 ? notConfirmedDead : eligible
  return orderCandidatesByRegion(fallbackPool, regionPriority, probeCache)
}

export function buildSparkleMailProviderDocument(input: {
  proxies: MailProxyRecord[]
  regionPriority: readonly string[]
  probeCache?: MailNodeProbeCache
}): { proxies: MailProxyRecord[] } {
  return {
    proxies: orderMailProxies(input.proxies, input.regionPriority, input.probeCache)
  }
}

export interface MailProxyGroupShape {
  name: string
  type?: string
  url?: string
  interval?: number
  tolerance?: number
  timeout?: number
  lazy?: boolean
  hidden?: boolean
  proxies?: string[]
  use?: string[]
}

export function buildMailGroupConfig(
  leafNames: string[],
  profileId: string | undefined
): MailProxyGroupShape | null {
  if (profileId) {
    return {
      name: MAIL_DEDICATED_GROUP_NAME,
      type: 'url-test',
      url: MAIL_DELAY_TEST_URL,
      interval: 300,
      tolerance: 150,
      timeout: 5000,
      lazy: true,
      use: [MAIL_NODE_PROVIDER_ID]
    }
  }

  const nonHkLeaves = leafNames.filter((name) => !isBlockedRegionNodeName(name))
  const mailMembers = nonHkLeaves.length > 0 ? nonHkLeaves : leafNames
  if (mailMembers.length === 0) {
    return null
  }
  return {
    name: MAIL_DEDICATED_GROUP_NAME,
    type: 'url-test',
    url: MAIL_DELAY_TEST_URL,
    interval: 300,
    tolerance: 150,
    timeout: 5000,
    lazy: true,
    proxies: mailMembers
  }
}

export function buildMailProbeHiddenGroupConfig(
  profileId: string | undefined
): MailProxyGroupShape | null {
  if (!profileId) {
    return null
  }
  return {
    name: MAIL_PROBE_HIDDEN_GROUP_NAME,
    type: 'select',
    hidden: true,
    use: [profileId],
    proxies: [CURSOR_DEDICATED_DIRECT_PROXY]
  }
}

export function ensureMailProbeListener(
  profile: MihomoConfig,
  profileId: string | undefined
): void {
  if (!profileId) {
    return
  }
  const existing = (profile.listeners as Array<Record<string, unknown>> | undefined) ?? []
  const filtered = existing.filter((item) => item?.name !== MAIL_PROBE_LISTENER_NAME)
  profile.listeners = [
    ...filtered,
    {
      name: MAIL_PROBE_LISTENER_NAME,
      type: 'mixed',
      port: MAIL_PROBE_LISTENER_PORT,
      listen: '127.0.0.1',
      proxy: MAIL_PROBE_HIDDEN_GROUP_NAME
    }
  ] as MihomoConfig['listeners']
}
