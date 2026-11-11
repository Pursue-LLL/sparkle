// [INPUT] sparkleMailPortProbe::withLocalProbeChannelLock (POS: 邮件/Gemini 共享探测通道) · 当前订阅节点 · sparkle-gemini-nodes.json
// [OUTPUT] loadSparkleGeminiRegionCache · loadGeminiBlockedNodeNames · verifyNodeGeminiRegion · bootstrapSparkleGeminiRegionAudit · startSparkleGeminiRegionAuditLoop
// [POS] 识别「HTTP 200 但被 Google GeoIP 判定为送中/不支持地区（如 vXmutd="ZZ"/"CN"/"HK" 或 google.cn）」的节点，
// 将确认锁区/送中的节点从 `sparkle-fast-proxies.yaml`（`自动选择`）中剔除并热重载。
// 网络超时或连接瞬断绝不误判为锁区（仅当明确提取到不支持的地区码时才记入锁区缓存）。

import { readFile, writeFile } from 'fs/promises'
import net from 'node:net'
import tls from 'node:tls'
import zlib from 'node:zlib'
import path from 'path'
import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { dataDir, profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { stringifyYaml } from '../utils/yaml'
import {
  AUTO_SELECT_GEMINI_PROBE_URL,
  AUTO_SELECT_GROUP_NAME
} from './defaultAutoSwitchProxy'
import {
  mihomoGroupDetail,
  mihomoProxyProviders,
  mihomoUnfixedProxy,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { extractProxies } from './provider'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  buildSparkleFastProviderDocument,
  FAST_NODE_PROVIDER_FILENAME,
  FAST_NODE_PROVIDER_ID
} from './sparkleFastProviderCore'
import {
  evaluateGeminiHtmlEligibility,
  resolveGeminiBlockedNodeNames,
  type GeminiRegionProbeRecord
} from './sparkleGeminiProbeCore'
import {
  MAIL_PROBE_LISTENER_PORT,
  type MailProxyRecord
} from './sparkleMailProviderCore'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { withLocalProbeChannelLock } from './sparkleMailPortProbe'

const CACHE_FILENAME = 'sparkle-gemini-nodes.json'
const ELIGIBLE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const INELIGIBLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const AUDIT_INTERVAL_MS = 30 * 60 * 1000
const STREAM_PROBE_TIMEOUT_MS = 5000
const MAX_INSPECTED_HTML_CHARS = 300_000

const GEMINI_HOST = 'gemini.google.com'
const GEMINI_PORT = 443

let memoryCache: Map<string, GeminiRegionProbeRecord> | null = null

function cacheFilePath(): string {
  return path.join(dataDir(), CACHE_FILENAME)
}

function isRecordFresh(record: GeminiRegionProbeRecord, nowMs: number): boolean {
  const ttl = record.eligible ? ELIGIBLE_CACHE_TTL_MS : INELIGIBLE_CACHE_TTL_MS
  return nowMs - record.checkedAt < ttl
}

export async function loadSparkleGeminiRegionCache(
  nowMs: number = Date.now()
): Promise<Map<string, GeminiRegionProbeRecord>> {
  if (memoryCache) {
    for (const [key, val] of memoryCache.entries()) {
      if (!isRecordFresh(val, nowMs)) {
        memoryCache.delete(key)
      }
    }
    return memoryCache
  }
  try {
    const raw = JSON.parse(await readFile(cacheFilePath(), 'utf8')) as Record<
      string,
      GeminiRegionProbeRecord
    >
    const map = new Map<string, GeminiRegionProbeRecord>()
    for (const [key, val] of Object.entries(raw)) {
      if (
        val &&
        typeof val.eligible === 'boolean' &&
        typeof val.countryCode === 'string' &&
        typeof val.checkedAt === 'number' &&
        isRecordFresh(val, nowMs)
      ) {
        map.set(key, val)
      }
    }
    memoryCache = map
    return map
  } catch {
    memoryCache = new Map()
    return memoryCache
  }
}

async function saveSparkleGeminiRegionCache(
  cache: ReadonlyMap<string, GeminiRegionProbeRecord>
): Promise<void> {
  const serialized = Object.fromEntries(cache.entries())
  await writeFile(cacheFilePath(), JSON.stringify(serialized, null, 2), 'utf8')
}

export async function loadGeminiBlockedNodeNames(
  proxies?: readonly MailProxyRecord[]
): Promise<Set<string>> {
  const cache = await loadSparkleGeminiRegionCache()
  if (cache.size === 0) {
    return new Set()
  }
  let targetProxies = proxies
  if (!targetProxies) {
    try {
      const { current } = await getProfileConfig()
      if (current && current !== 'default') {
        const currentProfile = await getProfile(current)
        targetProxies = extractProxies(currentProfile) as MailProxyRecord[]
      }
    } catch {
      targetProxies = undefined
    }
  }
  if (targetProxies && targetProxies.length > 0) {
    return resolveGeminiBlockedNodeNames(targetProxies, cache)
  }
  const fallback = new Set<string>()
  for (const [key, rec] of cache.entries()) {
    if (!rec.eligible && !key.includes('|')) {
      fallback.add(key)
    }
  }
  if (fallback.size === 0) {
    for (const [key, rec] of cache.entries()) {
      if (!rec.eligible) {
        const parts = key.split('|')
        const name = parts.length >= 4 ? parts.slice(0, -3).join('|') : key
        if (name) fallback.add(name)
      }
    }
  }
  return fallback
}

/**
 * 通过本地隐藏探测监听器 `127.0.0.1:17899` 对 `gemini.google.com:443` 发起带 gzip 的流式 HTTP/1.1 GET 请求，
 * 一旦在解压后的前 ~130KB HTML 中识别到 `vXmutd` 地区码或 `www.google.cn` 即刻断开连接返回结果。
 * 若发生网络超时或连接中断且尚未读到地区标记，返回 `definitive: false`，绝不将网络抖动误判为锁区。
 */
function streamProbeGeminiRegionViaLocalListener(
  timeoutMs: number = STREAM_PROBE_TIMEOUT_MS
): Promise<{ definitive: boolean; eligible: boolean; countryCode?: string }> {
  return new Promise((resolve) => {
    let settled = false
    let rawSocket: net.Socket | null = null
    let tlsSocket: tls.TLSSocket | null = null
    let gunzip: zlib.Gunzip | null = null

    const finish = (res: {
      definitive: boolean
      eligible: boolean
      countryCode?: string
    }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        gunzip?.destroy()
      } catch {
        // ignore cleanup error
      }
      try {
        tlsSocket?.destroy()
      } catch {
        // ignore cleanup error
      }
      try {
        rawSocket?.destroy()
      } catch {
        // ignore cleanup error
      }
      resolve(res)
    }

    const timer = setTimeout(
      () => finish({ definitive: false, eligible: true }),
      timeoutMs
    )

    rawSocket = net.connect(MAIL_PROBE_LISTENER_PORT, '127.0.0.1')
    rawSocket.once('error', () => finish({ definitive: false, eligible: true }))
    rawSocket.once('connect', () => {
      rawSocket?.write(
        `CONNECT ${GEMINI_HOST}:${GEMINI_PORT} HTTP/1.1\r\nHost: ${GEMINI_HOST}:${GEMINI_PORT}\r\n\r\n`
      )
      let connectBuf = ''
      const onConnectData = (chunk: Buffer): void => {
        connectBuf += chunk.toString('utf8')
        if (!connectBuf.includes('\r\n\r\n')) {
          if (connectBuf.length > 2048) {
            finish({ definitive: false, eligible: true })
          }
          return
        }
        rawSocket?.removeListener('data', onConnectData)
        const statusLine = connectBuf.slice(0, connectBuf.indexOf('\r\n'))
        if (!statusLine.includes(' 200 ')) {
          finish({ definitive: false, eligible: true })
          return
        }

        tlsSocket = tls.connect({
          socket: rawSocket!,
          servername: GEMINI_HOST,
          ALPNProtocols: ['http/1.1'],
          rejectUnauthorized: true
        })
        tlsSocket.once('error', () => finish({ definitive: false, eligible: true }))
        tlsSocket.once('secureConnect', () => {
          tlsSocket?.write(
            `GET /app HTTP/1.1\r\n` +
              `Host: ${GEMINI_HOST}\r\n` +
              `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36\r\n` +
              `Accept: text/html\r\n` +
              `Accept-Encoding: gzip\r\n` +
              `Connection: close\r\n\r\n`
          )

          let headerBuf = Buffer.alloc(0)
          let headerParsed = false
          let isChunked = false
          let chunkRemainder = Buffer.alloc(0)
          let htmlPrefix = ''

          const inspectHtmlChunk = (text: string): void => {
            if (settled) return
            htmlPrefix += text
            const evalRes = evaluateGeminiHtmlEligibility(htmlPrefix)
            if (evalRes.settled) {
              finish({
                definitive: true,
                eligible: evalRes.eligible,
                countryCode: evalRes.countryCode
              })
              return
            }
            if (htmlPrefix.length > MAX_INSPECTED_HTML_CHARS) {
              finish({ definitive: false, eligible: true })
            }
          }

          const feedBodyPayload = (payload: Buffer): void => {
            if (settled || payload.length === 0) return
            if (gunzip) {
              gunzip.write(payload)
            } else {
              inspectHtmlChunk(payload.toString('utf8'))
            }
          }

          const feedRawBody = (buf: Buffer): void => {
            if (settled || buf.length === 0) return
            if (!isChunked) {
              feedBodyPayload(buf)
              return
            }
            chunkRemainder = Buffer.concat([chunkRemainder, buf])
            while (chunkRemainder.length > 0) {
              if (settled) break
              const lineEnd = chunkRemainder.indexOf('\r\n')
              if (lineEnd === -1) break
              const sizeHex = chunkRemainder
                .subarray(0, lineEnd)
                .toString('ascii')
                .split(';')[0]
                .trim()
              const size = Number.parseInt(sizeHex, 16)
              if (Number.isNaN(size) || size === 0) break
              if (chunkRemainder.length < lineEnd + 2 + size + 2) break
              const payload = chunkRemainder.subarray(lineEnd + 2, lineEnd + 2 + size)
              chunkRemainder = chunkRemainder.subarray(lineEnd + 2 + size + 2)
              feedBodyPayload(payload)
            }
          }

          tlsSocket?.on('data', (chunk: Buffer) => {
            if (settled) return
            if (!headerParsed) {
              headerBuf = Buffer.concat([headerBuf, chunk])
              const headerEnd = headerBuf.indexOf('\r\n\r\n')
              if (headerEnd === -1) {
                if (headerBuf.length > 32_768) {
                  finish({ definitive: false, eligible: true })
                }
                return
              }
              headerParsed = true
              const headerStr = headerBuf.subarray(0, headerEnd).toString('utf8')
              const firstLine = headerStr.slice(0, headerStr.indexOf('\r\n'))
              if (!firstLine.includes(' 200')) {
                finish({ definitive: false, eligible: true })
                return
              }
              isChunked = /transfer-encoding:\s*chunked/i.test(headerStr)
              const isGzip = /content-encoding:\s*gzip/i.test(headerStr)
              if (isGzip) {
                gunzip = zlib.createGunzip()
                gunzip.on('error', () => {
                  // ignore trailing gunzip error on early socket close
                })
                gunzip.on('data', (decompressed: Buffer) => {
                  inspectHtmlChunk(decompressed.toString('utf8'))
                })
              }
              const bodyStart = headerBuf.subarray(headerEnd + 4)
              headerBuf = Buffer.alloc(0)
              feedRawBody(bodyStart)
            } else {
              feedRawBody(chunk)
            }
          })

          tlsSocket?.once('end', () => finish({ definitive: false, eligible: true }))
        })
      }
      rawSocket?.on('data', onConnectData)
    })
  })
}

async function resolveCurrentProfileProxies(): Promise<MailProxyRecord[]> {
  try {
    const { current } = await getProfileConfig()
    if (!current || current === 'default') {
      return []
    }
    const currentProfile = await getProfile(current)
    return extractProxies(currentProfile) as MailProxyRecord[]
  } catch {
    return []
  }
}

/** 当新发现锁区/送中节点时，立即重写 `sparkle-fast-proxies.yaml` 并通知 mihomo 热重载。 */
export async function rebuildAndReloadSparkleFastProvider(): Promise<void> {
  try {
    const proxies = await resolveCurrentProfileProxies()
    if (proxies.length === 0) {
      return
    }
    const { proxySwitchPriority = [] } = await getAppConfig()
    const { loadSparkleFastDelaySnapshot } = await import('./sparkleFastLatencyOrder')
    const [delaySnapshot, blockedNodeNames] = await Promise.all([
      loadSparkleFastDelaySnapshot(proxies),
      loadGeminiBlockedNodeNames(proxies)
    ])
    const doc = buildSparkleFastProviderDocument({
      proxies,
      regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority),
      delayMs: delaySnapshot.size > 0 ? delaySnapshot : undefined,
      blockedNodeNames
    })
    await writeFile(
      path.join(profilesDir(), FAST_NODE_PROVIDER_FILENAME),
      stringifyYaml(doc),
      'utf8'
    )
    await mihomoUpdateProxyProviders(FAST_NODE_PROVIDER_ID)
    const group = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
    if (group.fixed && blockedNodeNames.has(group.fixed)) {
      await mihomoUnfixedProxy(AUTO_SELECT_GROUP_NAME)
    }
  } catch (error) {
    await appendAppLog(
      `[SparkleGeminiProbe]: rebuild sparkle-fast failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
  }
}

/**
 * 校验单个节点是否真正解锁 Gemini 地区限制（非送中/锁区）：
 * - 命中缓存时直接 O(1) 返回；
 * - 未命中缓存时通过隐藏探测监听器流式检查 `https://gemini.google.com/app` 的 `vXmutd` 地区码；
 * - 若确认锁区（如 `ZZ`/`CN`/`HK`），立即记入黑名单并触发 `sparkle-fast` 热重载剔除该节点。
 */
export async function verifyNodeGeminiRegion(
  nodeName: string,
  options?: { skipProviderReloadOnReject?: boolean }
): Promise<{ eligible: boolean; countryCode?: string; definitive: boolean }> {
  const trimmed = nodeName.trim()
  if (!trimmed) {
    return { eligible: true, definitive: false }
  }

  const cache = await loadSparkleGeminiRegionCache()
  const proxies = await resolveCurrentProfileProxies()
  const matchedProxy = proxies.find((p) => String(p.name ?? '').trim() === trimmed)
  const cacheKey = matchedProxy ? computeProxyNodeFingerprint(matchedProxy) : trimmed

  const existing = cache.get(cacheKey) ?? cache.get(trimmed)
  if (existing) {
    return {
      eligible: existing.eligible,
      countryCode: existing.countryCode,
      definitive: true
    }
  }

  try {
    const res = await withLocalProbeChannelLock(trimmed, () =>
      streamProbeGeminiRegionViaLocalListener()
    )
    if (!res.definitive || !res.countryCode) {
      return { eligible: true, definitive: false }
    }

    const record: GeminiRegionProbeRecord = {
      eligible: res.eligible,
      countryCode: res.countryCode,
      checkedAt: Date.now()
    }
    cache.set(cacheKey, record)
    cache.set(trimmed, record)
    await saveSparkleGeminiRegionCache(cache)

    if (!res.eligible) {
      await appendAppLog(
        `[SparkleGeminiProbe]: evicted region-restricted node "${trimmed}" (region=${res.countryCode})\n`
      )
      if (!options?.skipProviderReloadOnReject) {
        await rebuildAndReloadSparkleFastProvider()
      }
    } else {
      await appendAppLog(
        `[SparkleGeminiProbe]: verified eligible node "${trimmed}" (region=${res.countryCode})\n`
      )
    }

    return {
      eligible: res.eligible,
      countryCode: res.countryCode,
      definitive: true
    }
  } catch {
    return { eligible: true, definitive: false }
  }
}

let auditInFlight = false

/**
 * 后台巡检 `sparkle-fast` 中 mihomo 判定为 `alive: true` 但尚未缓存 Gemini 地区码的节点，
 * 提前把潜伏的“送中”节点剔除出 `自动选择` 候选池。
 */
export async function bootstrapSparkleGeminiRegionAudit(): Promise<void> {
  if (auditInFlight) {
    return
  }
  auditInFlight = true
  try {
    const provider = (await mihomoProxyProviders()).providers[FAST_NODE_PROVIDER_ID]
    const leaves = provider?.proxies ?? []
    if (leaves.length === 0) {
      return
    }

    const cache = await loadSparkleGeminiRegionCache()
    const proxies = await resolveCurrentProfileProxies()
    const fingerprintByName = new Map<string, string>()
    for (const p of proxies) {
      const n = String(p.name ?? '').trim()
      if (n) fingerprintByName.set(n, computeProxyNodeFingerprint(p))
    }

    const unverifiedAliveNames = leaves
      .filter((leaf) => {
        const alive = leaf.extra?.[AUTO_SELECT_GEMINI_PROBE_URL]?.alive ?? leaf.alive
        if (!alive) return false
        const fp = fingerprintByName.get(leaf.name)
        return !(fp && cache.has(fp)) && !cache.has(leaf.name)
      })
      .map((leaf) => leaf.name)

    if (unverifiedAliveNames.length === 0) {
      return
    }

    let newlyRejected = 0
    for (const name of unverifiedAliveNames) {
      const res = await verifyNodeGeminiRegion(name, { skipProviderReloadOnReject: true })
      if (res.definitive && !res.eligible) {
        newlyRejected += 1
      }
    }

    if (newlyRejected > 0) {
      await rebuildAndReloadSparkleFastProvider()
      await appendAppLog(
        `[SparkleGeminiProbe]: audit finished probed=${unverifiedAliveNames.length} newly_evicted=${newlyRejected}\n`
      )
    }
  } catch (error) {
    await appendAppLog(
      `[SparkleGeminiProbe]: audit error=${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    auditInFlight = false
  }
}

let geminiAuditTimer: NodeJS.Timeout | undefined

export function startSparkleGeminiRegionAuditLoop(): void {
  if (geminiAuditTimer) {
    return
  }
  geminiAuditTimer = setInterval(() => {
    bootstrapSparkleGeminiRegionAudit().catch(() => undefined)
  }, AUDIT_INTERVAL_MS)
  geminiAuditTimer.unref()
}
