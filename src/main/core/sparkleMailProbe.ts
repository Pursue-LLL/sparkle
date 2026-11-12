// [INPUT] sparkleMailPortProbe::probeSingleNodeMailPorts (POS: 单节点 993/465 TLS Banner 校验) ·
//         sparkleMailProviderCore::buildSparkleMailProviderDocument (POS: sparkle-mail provider 文档生成) ·
//         当前订阅节点 · sparkle-mail-nodes.json
// [OUTPUT] loadSparkleMailProbeCache · saveSparkleMailProbeCache · writeSparkleMailProviderFromCache · ensureMailProviderReloaded · reloadAndWarmMailGroup · bootstrapSparkleMailProvider · loadCurrentMailProxies · runSparkleMailProbeExclusive · startSparkleMailProbeLoop
// [POS] 邮件 provider 的全量探测与同步：对订阅叶子执行真实 993/465 校验，把结果写入 `sparkle-mail-proxies.yaml`；成员集合变化时热重载 `📧 邮件专用`，
// 热重载失败保留 pending 由后续按需/每小时探测重试。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { dataDir, profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { isAnyTlsProxyType } from './autoSelectAnyTlsExclusionCore'
import { MAIL_DEDICATED_GROUP_NAME, MAIL_DELAY_TEST_URL } from './cursorProxyGroup'
import { mihomoGroupDelay, mihomoUpdateProxyProviders } from './mihomoApi'
import { extractProxies } from './provider'
import { resolveEffectiveRegionPriority } from './regionPriority'
import { probeSingleNodeMailPorts } from './sparkleMailPortProbe'
import {
  buildSparkleMailProviderDocument,
  isPreferredMailCandidateType,
  mailProviderMembershipChanged,
  MAIL_NODE_PROVIDER_FILENAME,
  MAIL_NODE_PROVIDER_ID,
  type MailNodeProbeCache,
  type MailNodeProbeRecord,
  type MailProxyRecord
} from './sparkleMailProviderCore'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'

const CACHE_FILENAME = 'sparkle-mail-nodes.json'
const ALIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const DEAD_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const RECHECK_INTERVAL_MS = 60 * 60 * 1000

/** provider 文件已变但内核热重载尚未成功；后续按需/每小时探测继续重试，避免死节点留在 live provider。 */
let providerReloadPending = false
/** 只记录第一次连续失败，避免内核长期不可达时每 5 分钟刷日志。 */
let providerReloadFailing = false

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

export async function saveSparkleMailProbeCache(
  cache: ReadonlyMap<string, MailNodeProbeRecord>
): Promise<void> {
  const serialized = Object.fromEntries(cache.entries())
  await writeFile(cacheFilePath(), JSON.stringify(serialized, null, 2), 'utf8')
}

export async function loadCurrentMailProxies(): Promise<MailProxyRecord[]> {
  const { current } = await getProfileConfig()
  if (!current || current === 'default') {
    return []
  }
  const currentProfile = await getProfile(current)
  return extractProxies(currentProfile) as MailProxyRecord[]
}

export interface MailProviderWriteResult {
  count: number
  membershipChanged: boolean
}

async function readMailProviderMembers(): Promise<string[]> {
  try {
    const doc = parseYaml<{ proxies?: MailProxyRecord[] }>(
      await readFile(providerFilePath(), 'utf8')
    )
    return (doc.proxies ?? [])
      .map((proxy) => String(proxy.name ?? '').trim())
      .filter((name) => name.length > 0)
  } catch {
    return []
  }
}

export async function writeSparkleMailProviderFromCache(
  proxies: MailProxyRecord[],
  regionPriority: readonly string[],
  probeCache?: MailNodeProbeCache
): Promise<MailProviderWriteResult> {
  const doc = buildSparkleMailProviderDocument({
    proxies,
    regionPriority,
    probeCache
  })
  const nextMembers = doc.proxies.map((proxy) => String(proxy.name ?? '').trim())
  const previousMembers = await readMailProviderMembers()
  const membershipChanged = mailProviderMembershipChanged(previousMembers, nextMembers)
  await writeFile(providerFilePath(), stringifyYaml(doc), 'utf8')
  if (membershipChanged) {
    providerReloadPending = true
  }
  return {
    count: nextMembers.length,
    membershipChanged
  }
}

export async function reloadAndWarmMailGroup(): Promise<void> {
  try {
    await mihomoUpdateProxyProviders(MAIL_NODE_PROVIDER_ID)
    providerReloadPending = false
    providerReloadFailing = false
  } catch (error) {
    providerReloadPending = true
    if (!providerReloadFailing) {
      providerReloadFailing = true
      await appendAppLog(
        `[SparkleMailProbe]: provider reload failed err=${error instanceof Error ? error.message : String(error)}\n`
      )
    }
    return
  }
  try {
    await mihomoGroupDelay(MAIL_DEDICATED_GROUP_NAME, MAIL_DELAY_TEST_URL)
  } catch {
    // best-effort warmup
  }
}

/** 只有 provider 文件成员变化且上一次热重载失败时才重试；成功一次后为空操作。 */
export async function ensureMailProviderReloaded(): Promise<void> {
  if (!providerReloadPending) {
    return
  }
  await reloadAndWarmMailGroup()
}

let mailProbeTail: Promise<void> = Promise.resolve()

/** 串行执行邮件 provider 探测/写盘/重载，避免全量补测与当前节点复测互相覆盖缓存。 */
export function runSparkleMailProbeExclusive(task: () => Promise<void>): Promise<void> {
  const run = mailProbeTail.then(
    () => task(),
    () => task()
  )
  mailProbeTail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

let bootstrapQueued = false

export async function bootstrapSparkleMailProvider(): Promise<void> {
  if (bootstrapQueued) {
    return
  }
  bootstrapQueued = true
  try {
    await runSparkleMailProbeExclusive(runBootstrapSparkleMailProvider)
  } finally {
    bootstrapQueued = false
  }
}

async function runBootstrapSparkleMailProvider(): Promise<void> {
  try {
    const proxies = await loadCurrentMailProxies()
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
      const { count } = await writeSparkleMailProviderFromCache(proxies, regionPriority, cache)
      await ensureMailProviderReloaded()
      await appendAppLog(
        `[SparkleMailProbe]: loaded ${cachedAliveCount} verified mail nodes from cache active_pool=${count}\n`
      )
    }

    const unprobed = eligible.filter((proxy) => !cache.has(computeProxyNodeFingerprint(proxy)))
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
      const { count } = await writeSparkleMailProviderFromCache(proxies, regionPriority, cache)
      await ensureMailProviderReloaded()
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
      const { count } = await writeSparkleMailProviderFromCache(proxies, regionPriority, cache)
      await ensureMailProviderReloaded()
      await appendAppLog(
        `[SparkleMailProbe]: full-tier probed=${remainingUnprobed.length} newly_alive=${bgAlive} active_pool=${count}\n`
      )
    }
  } catch (error) {
    await appendAppLog(
      `[SparkleMailProbe]: error=${error instanceof Error ? error.message : String(error)}\n`
    )
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
