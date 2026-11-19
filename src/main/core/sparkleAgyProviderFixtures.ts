// [INPUT] sparkleAgyProviderCore 的类型 · proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹)
// [OUTPUT] NODES · REGION_PRIORITY · record · names · vmess · cacheOf
// [POS] agy provider 排序类测试共用的节点夹具与小工具。仅供测试使用。

import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import type { AgyNodeProbeRecord, AgyProxyRecord } from './sparkleAgyProviderCore'

export const NODES: AgyProxyRecord[] = [
  { name: '新加坡-优化2-GPT', type: 'vmess', server: 'sg.a.example', port: 16618 },
  { name: '美国LA-优化2-GPT', type: 'vmess', server: 'us.a.example', port: 16648 },
  { name: '美国LA-优化3-GPT', type: 'vmess', server: 'us.b.example', port: 16648 },
  { name: '🇯🇵 日本 02', type: 'vless', server: 'jp.example', port: 443 },
  { name: '🇭🇰 香港 01', type: 'vmess', server: 'hk.example', port: 443 },
  { name: '🇹🇼 台湾 01', type: 'anytls', server: 'tw.tls.example', port: 27005 }
]

export const REGION_PRIORITY = ['台湾', '日本', '韩国', '新加坡', '美国']

export function record(usable: boolean, rttMs: number): AgyNodeProbeRecord {
  return { usable, rttMs, checkedAt: 1000 }
}

export function names(proxies: readonly AgyProxyRecord[]): string[] {
  return proxies.map((proxy) => String(proxy.name))
}

export function vmess(name: string): AgyProxyRecord {
  return { name, type: 'vmess', server: `${name}.example`, port: 443 }
}

export function cacheOf(
  entries: Array<[AgyProxyRecord, AgyNodeProbeRecord]>
): Map<string, AgyNodeProbeRecord> {
  return new Map(entries.map(([proxy, probe]) => [computeProxyNodeFingerprint(proxy), probe]))
}
