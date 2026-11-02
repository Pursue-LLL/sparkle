// [INPUT] 当前订阅节点 · 隐藏探测通道 127.0.0.1:17899 (__sparkle_mail_probe__) · sparkle-mail-nodes.json
// [OUTPUT] loadSparkleMailProbeCache · writeSparkleMailProviderFromCache · bootstrapSparkleMailProvider · startSparkleMailProbeLoop
// [POS] 对订阅节点执行真实 `imap.gmail.com:993`（IMAPS `* OK`）与 `smtp.gmail.com:465`（SMTPS `220`）TLS 握手与协议 Banner 校验，
// 将 100% 确认双通的节点写入 `sparkle-mail-proxies.yaml` 并热重载 `📧 邮件专用` 组。

import { readFile, writeFile } from 'fs/promises'
import net from 'node:net'
import tls from 'node:tls'
import { performance } from 'node:perf_hooks'
import path from 'path'
import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { dataDir, profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { stringifyYaml } from '../utils/yaml'
import { isAnyTlsProxyType } from './autoSelectAnyTlsExclusionCore'
import {
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_DELAY_TEST_URL,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'
import {
  mihomoChangeProxy,
  mihomoGroupDelay,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { extractProxies } from './provider'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  buildSparkleMailProviderDocument,
  isPreferredMailCandidateType,
  MAIL_NODE_PROVIDER_FILENAME,
  MAIL_NODE_PROVIDER_ID,
  MAIL_PROBE_LISTENER_PORT,
  type MailNodeProbeCache,
  type MailNodeProbeRecord,
  type MailProxyRecord
} from './sparkleMailProviderCore'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'

const CACHE_FILENAME = 'sparkle-mail-nodes.json'
const ALIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const DEAD_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const RECHECK_INTERVAL_MS = 60 * 60 * 1000
const PORT_PROBE_TIMEOUT_MS = 3500

const IMAP_HOST = 'imap.gmail.com'
const IMAP_PORT = 993
const IMAP_BANNER_PREFIX = '* OK'

const SMTP_HOST = 'smtp.gmail.com'
const SMTP_PORT = 465
const SMTP_BANNER_PREFIX = '220'

function cacheFilePath(): string {
  return path.join(dataDir(), CACHE_FILENAME)
}

function providerFilePath(): string {
  return path.join(profilesDir(), MAIL_NODE_PROVIDER_FILENAME)
}

function isCacheRecordFresh(record: MailNodeProbeRecord, nowMs: number): boolean {
  const ttl = record.alive ? ALIVE_CACHE_TTL_MS : DEAD_CACHE_TTL_MS
  return nowMs - record.checkedAt < ttl
}

export async function loadSparkleMailProbeCache(
  nowMs: number = Date.now()
): Promise<Map<string, MailNodeProbeRecord>> {
  try {
    const raw = JSON.parse(await readFile(cacheFilePath(), 'utf8')) as Record<
      string,
      MailNodeProbeRecord
    >
    const map = new Map<string, MailNodeProbeRecord>()
    for (const [key, val] of Object.entries(raw)) {
      if (
        val &&
        typeof val.alive === 'boolean' &&
        typeof val.rttMs === 'number' &&
        typeof val.checkedAt === 'number' &&
        isCacheRecordFresh(val, nowMs)
      ) {
        map.set(key, val)
      }
    }
    return map
  } catch {
    return new Map()
  }
}

async function saveSparkleMailProbeCache(
  cache: ReadonlyMap<string, MailNodeProbeRecord>
): Promise<void> {
  const serialized = Object.fromEntries(cache.entries())
  await writeFile(cacheFilePath(), JSON.stringify(serialized, null, 2), 'utf8')
}

/** 通过本地隐藏探测监听器 `127.0.0.1:17899` 对目标邮件端口执行 HTTP CONNECT + TLS 握手 + 首行协议 Banner 校验。 */
function probeTlsBannerViaLocalListener(
  host: string,
  port: number,
  expectedBannerPrefix: string,
  timeoutMs: number = PORT_PROBE_TIMEOUT_MS
): Promise<{ ok: boolean; rttMs: number }> {
  return new Promise((resolve) => {
    const startMs = performance.now()
    let settled = false
    let rawSocket: net.Socket | null = null
    let tlsSocket: tls.TLSSocket | null = null

    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        tlsSocket?.destroy()
      } catch {
        // ignore socket cleanup errors
      }
      try {
        rawSocket?.destroy()
      } catch {
        // ignore socket cleanup errors
      }
      resolve({ ok, rttMs: Math.max(1, Math.round(performance.now() - startMs)) })
    }

    const timer = setTimeout(() => finish(false), timeoutMs)

    rawSocket = net.connect(MAIL_PROBE_LISTENER_PORT, '127.0.0.1')
    rawSocket.once('error', () => finish(false))
    rawSocket.once('connect', () => {
      rawSocket?.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`)
      let connectBuf = ''
      const onConnectData = (chunk: Buffer): void => {
        connectBuf += chunk.toString('utf8')
        const headerEnd = connectBuf.indexOf('\r\n\r\n')
        if (headerEnd === -1) {
          if (connectBuf.length > 2048) finish(false)
          return
        }
        rawSocket?.removeListener('data', onConnectData)
        const statusLine = connectBuf.slice(0, connectBuf.indexOf('\r\n'))
        if (!statusLine.includes(' 200 ')) {
          finish(false)
          return
        }

        tlsSocket = tls.connect({
          socket: rawSocket!,
          servername: host,
          rejectUnauthorized: true
        })
        tlsSocket.once('error', () => finish(false))
        tlsSocket.once('data', (bannerChunk: Buffer) => {
          const banner = bannerChunk.toString('utf8').trim()
          finish(banner.startsWith(expectedBannerPrefix))
        })
      }
      rawSocket?.on('data', onConnectData)
    })
  })
}

let probeChannelTail: Promise<void> = Promise.resolve()

/**
 * 进程级互斥锁：本地隐藏探测监听器 `127.0.0.1:17899`（`__sparkle_mail_probe__`）为单通道，
 * 邮件端口探测与 Gemini 地区内容探测共享该通道时必须串行切换节点，防止并发串台。
 */
export async function withLocalProbeChannelLock<T>(
  nodeName: string,
  task: () => Promise<T>
): Promise<T> {
  const prev = probeChannelTail
  let release!: () => void
  probeChannelTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  try {
    await mihomoChangeProxy(MAIL_PROBE_HIDDEN_GROUP_NAME, nodeName)
    return await task()
  } finally {
    release()
  }
}

/** 实测单个节点的 `imap.gmail.com:993`（收件）与 `smtp.gmail.com:465`（发件）是否双通。 */
async function probeSingleNodeMailPorts(nodeName: string): Promise<{ alive: boolean; rttMs: number }> {
  try {
    return await withLocalProbeChannelLock(nodeName, async () => {
      const imapRes = await probeTlsBannerViaLocalListener(
        IMAP_HOST,
        IMAP_PORT,
        IMAP_BANNER_PREFIX
      )
      if (!imapRes.ok) {
        return { alive: false, rttMs: 0 }
      }

      const smtpRes = await probeTlsBannerViaLocalListener(
        SMTP_HOST,
        SMTP_PORT,
        SMTP_BANNER_PREFIX
      )
      if (!smtpRes.ok) {
        return { alive: false, rttMs: 0 }
      }

      return {
        alive: true,
        rttMs: Math.round((imapRes.rttMs + smtpRes.rttMs) / 2)
      }
    })
  } catch {
    return { alive: false, rttMs: 0 }
  }
}

export async function writeSparkleMailProviderFromCache(
  proxies: MailProxyRecord[],
  regionPriority: readonly string[],
  probeCache?: MailNodeProbeCache
): Promise<number> {
  const doc = buildSparkleMailProviderDocument({
    proxies,
    regionPriority,
    probeCache
  })
  await writeFile(providerFilePath(), stringifyYaml(doc), 'utf8')
  return doc.proxies.length
}

async function reloadAndWarmMailGroup(): Promise<void> {
  try {
    await mihomoUpdateProxyProviders(MAIL_NODE_PROVIDER_ID)
    await mihomoGroupDelay(MAIL_DEDICATED_GROUP_NAME, MAIL_DELAY_TEST_URL)
  } catch {
    // best-effort warmup
  }
}

let probeInFlight = false

export async function bootstrapSparkleMailProvider(): Promise<void> {
  if (probeInFlight) {
    return
  }
  probeInFlight = true
  try {
    const { current } = await getProfileConfig()
    if (!current || current === 'default') {
      return
    }
    const currentProfile = await getProfile(current)
    const proxies = extractProxies(currentProfile) as MailProxyRecord[]
    if (proxies.length === 0) {
      return
    }

    const { proxySwitchPriority = [] } = await getAppConfig()
    const regionPriority = resolveEffectiveRegionPriority(proxySwitchPriority)
    const cache = await loadSparkleMailProbeCache()

    const eligible = proxies.filter(
      (proxy) =>
        typeof proxy.name === 'string' &&
        proxy.name.trim().length > 0 &&
        !isAnyTlsProxyType(String(proxy.type ?? ''))
    )

    const cachedAliveCount = eligible.filter(
      (proxy) => cache.get(computeProxyNodeFingerprint(proxy))?.alive === true
    ).length
    if (cachedAliveCount > 0) {
      await writeSparkleMailProviderFromCache(proxies, regionPriority, cache)
      await reloadAndWarmMailGroup()
      await appendAppLog(
        `[SparkleMailProbe]: loaded ${cachedAliveCount} verified mail nodes from cache\n`
      )
    }

    const unprobed = eligible.filter(
      (proxy) => !cache.has(computeProxyNodeFingerprint(proxy))
    )
    if (unprobed.length === 0) {
      return
    }

    const preferredUnprobed = unprobed.filter((proxy) => isPreferredMailCandidateType(proxy))
    const remainingUnprobed = unprobed.filter((proxy) => !isPreferredMailCandidateType(proxy))

    let newlyAlive = 0
    for (const proxy of preferredUnprobed) {
      const name = String(proxy.name ?? '').trim()
      const res = await probeSingleNodeMailPorts(name)
      cache.set(computeProxyNodeFingerprint(proxy), {
        alive: res.alive,
        rttMs: res.rttMs,
        checkedAt: Date.now()
      })
      if (res.alive) {
        newlyAlive += 1
      }
    }

    if (preferredUnprobed.length > 0) {
      await saveSparkleMailProbeCache(cache)
      const count = await writeSparkleMailProviderFromCache(proxies, regionPriority, cache)
      if (newlyAlive > 0 || cachedAliveCount === 0) {
        await reloadAndWarmMailGroup()
      }
      await appendAppLog(
        `[SparkleMailProbe]: fast-tier probed=${preferredUnprobed.length} newly_alive=${newlyAlive} active_pool=${count}\n`
      )
    }

    let bgAlive = 0
    for (const proxy of remainingUnprobed) {
      const name = String(proxy.name ?? '').trim()
      const res = await probeSingleNodeMailPorts(name)
      cache.set(computeProxyNodeFingerprint(proxy), {
        alive: res.alive,
        rttMs: res.rttMs,
        checkedAt: Date.now()
      })
      if (res.alive) {
        bgAlive += 1
      }
    }

    if (remainingUnprobed.length > 0) {
      await saveSparkleMailProbeCache(cache)
      const count = await writeSparkleMailProviderFromCache(proxies, regionPriority, cache)
      if (bgAlive > 0) {
        await reloadAndWarmMailGroup()
      }
      await appendAppLog(
        `[SparkleMailProbe]: full-tier probed=${remainingUnprobed.length} newly_alive=${bgAlive} active_pool=${count}\n`
      )
    }
  } catch (error) {
    await appendAppLog(
      `[SparkleMailProbe]: error=${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    probeInFlight = false
  }
}

let mailProbeTimer: NodeJS.Timeout | undefined

export function startSparkleMailProbeLoop(): void {
  if (mailProbeTimer) {
    return
  }
  mailProbeTimer = setInterval(() => {
    bootstrapSparkleMailProvider().catch(() => undefined)
  }, RECHECK_INTERVAL_MS)
  mailProbeTimer.unref()
}
