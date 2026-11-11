// [INPUT] 当前订阅节点 · `🎯 agy 专用` 组 · 官方 agy CLI（keychain 登录） · 探测专用干净目录 · 探测缓存（sparkleAgyProbeCache）
// [OUTPUT] bootstrapSparkleAgyProvider · startSparkleAgyProbeLoop · getSparkleAgyProbeSnapshot
// [POS] 用官方 agy CLI 的真实请求给节点定性：200 = 可用，400 `User location is not supported` = 不可用。
// 干净目录不加载用户的 skills / MCP / 全局规则（34k → 6.9k input），同时保留官方客户端的全部请求特征。
// 归因约束：agy 每次探测都是新进程，切组后由 mihomo 的新连接接管；仍保留 mihomoCloseConnections 清掉旧连接。

import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { homedir } from 'node:os'
import { copyFile, mkdir, readdir, stat, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { dataDir, profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { stringifyYaml } from '../utils/yaml'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { loadSparkleAgyProbeCache, saveSparkleAgyProbeCache } from './sparkleAgyProbeCache'
import {
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoGroupDetail,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { extractProxies } from './provider'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  AGY_NODE_PROVIDER_FILENAME,
  AGY_NODE_PROVIDER_ID,
  buildAgyProbeSnapshot,
  buildSparkleAgyProviderDocument,
  classifyAgyProbeResponse,
  orderAgyRepairProxies,
  type AgyNodeProbeCache,
  type AgyNodeProbeRecord,
  type AgyProbeVerdict,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'
import {
  resolveAgyAuditBackoffMs,
  runAgyAudit,
  shouldRepairAgyPin,
  type AgyAuditOutcome
} from './sparkleAgyProbeCore'

const AGY_BIN = path.join(homedir(), '.local/bin/agy')
const AGY_PROBE_MODEL = 'gemini-3.8-flash-low'
/**
 * 探测专用数据目录：只保留官方 CLI 的最小状态（登录走钥匙串，不受目录影响）。
 * 不能复用 ~/.gemini/antigravity-cli —— 那里会加载用户的 skills / MCP / 全局规则，
 * 单次 print 的 input 从 6.9k 膨胀到 34k（实测）。
 */
const AGY_PROBE_DIR = path.join(dataDir(), 'agy-probe')
/** 探测会话只用于进程内的一次性请求；保留 24h 便于排查，之后清掉，避免每天 ~22MB 的 DB 累积。 */
const AGY_PROBE_CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000

/** 原生 agy 探测结果：与 requestMagpie 的返回同形，供 probeSingleNode 复用。 */
type NativeAgyResponse =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'unreachable' }
  | { kind: 'timeout' }

/**
 * pin（当前钉住的节点）就地复测周期：只发 1 个 1-token 请求、不切组、不断流。
 * 可用缓存 TTL 是 12h（sparkleAgyProbeCache），30 分钟一轮已有 24 倍余量；
 * 5 分钟一轮纯属浪费官方账号配额（实测 6.9k input/次）。
 */
const PIN_CHECK_INTERVAL_MS = 30 * 60 * 1000
/** 单轮修复扫描最多探测多少个节点：避免一次把过多请求打给 Google 触发风控。 */
const MAX_PROBES_PER_REPAIR = 6
/** 修复扫描预算：超时节点会逐个吃掉探测超时，不能让「候选节点轮转」的窗口无限拉长。 */
const REPAIR_BUDGET_MS = 5 * 60 * 1000
/**
 * 探测超时：agy CLI 冷启动 + 模型排队可能超过 30s；pin 给足 90s，修复扫描给 60s。
 * 慢 ≠ 坏；超时只记 unknown，不把节点判死。
 */
const PIN_PROBE_TIMEOUT_MS = 90_000
const REPAIR_PROBE_TIMEOUT_MS = 60_000

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
 * 清理探测目录里的历史会话：探测是一次性请求，保留 24h 足够排查；
 * 不清理的话每次 print 都会新建一个 ~448KB 的 SQLite（每天约 22MB）。
 */
async function pruneAgyProbeConversations(cliDir: string): Promise<void> {
  const conversationsDir = path.join(cliDir, 'conversations')
  let entries: string[]
  try {
    entries = await readdir(conversationsDir)
  } catch {
    return
  }
  const cutoff = Date.now() - AGY_PROBE_CONVERSATION_TTL_MS
  await Promise.all(
    entries
      .filter((name) => /\.db(?:-(?:wal|shm))?$/.test(name))
      .map(async (name) => {
        const filePath = path.join(conversationsDir, name)
        try {
          const info = await stat(filePath)
          if (info.mtimeMs < cutoff) {
            await unlink(filePath)
          }
        } catch {
          // 清理是 best-effort，失败不影响探测。
        }
      })
  )
}

/** 探测目录只初始化一次；失败也继续 spawn，由 agy 自行创建目录。 */
let agyProbeDirReady: Promise<void> | null = null

function ensureAgyProbeDir(): Promise<void> {
  if (agyProbeDirReady) {
    return agyProbeDirReady
  }
  agyProbeDirReady = (async () => {
    const cliDir = path.join(AGY_PROBE_DIR, 'antigravity-cli')
    await mkdir(cliDir, { recursive: true })
    // 复用主目录的 installation_id：同一台机器不应因为探测目录多出一个“新设备”。
    try {
      await copyFile(
        path.join(homedir(), '.gemini/antigravity-cli/installation_id'),
        path.join(cliDir, 'installation_id'),
        constants.COPYFILE_EXCL
      )
    } catch {
      // 已存在或主目录没有该文件：保持现状即可。
    }
    await pruneAgyProbeConversations(cliDir)
  })().catch(() => undefined)
  return agyProbeDirReady
}

async function requestNativeAgy(model: string, timeoutMs: number): Promise<NativeAgyResponse> {
  await ensureAgyProbeDir()
  return new Promise((resolve) => {
    const printTimeoutSec = Math.max(15, Math.floor(timeoutMs / 1000) - 5)
    const env = { ...process.env }
    delete env.GEMINI_API_KEY
    delete env.GOOGLE_GEMINI_BASE_URL
    delete env.GOOGLE_API_KEY
    delete env.CLOUD_CODE_URL
    let child
    try {
      child = spawn(
        AGY_BIN,
        [
          '--gemini_dir',
          AGY_PROBE_DIR,
          '--print',
          'Reply with exactly: OK',
          '--model',
          model || AGY_PROBE_MODEL,
          '--print-timeout',
          `${printTimeoutSec}s`,
          '--output-format',
          'text'
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch {
      resolve({ kind: 'unreachable' })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (value: NativeAgyResponse): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // 进程可能已经退出，忽略即可。
      }
      finish({ kind: 'timeout' })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 16384) {
        stdout += chunk.toString()
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 16384) {
        stderr += chunk.toString()
      }
    })
    child.on('error', () => finish({ kind: 'unreachable' }))
    child.on('close', (code) => {
      const body = `${stdout}\n${stderr}`
      if (/User location is not supported/i.test(body)) {
        finish({ kind: 'response', status: 400, body })
        return
      }
      if (code === 0) {
        finish({ kind: 'response', status: 200, body })
        return
      }
      if (/FAILED_PRECONDITION|PERMISSION_DENIED|not logged|sign in|authentication/i.test(body)) {
        finish({ kind: 'response', status: 403, body })
        return
      }
      finish({ kind: 'response', status: 500, body })
    })
  })
}

/**
 * 单节点探测。归因保证：
 * 1. 组选择被外部改动过 → 先断旧连接；
 * 2. 目标不是当前选择 → 切组后立刻断连接；
 * 3. 断连接失败 → 返回 unknown，绝不把结果写到该节点头上。
 */
async function probeSingleNode(
  node: string,
  model: string,
  timeoutMs: number
): Promise<AgyAuditOutcome> {
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
  const response = await requestNativeAgy(model, timeoutMs)
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

function countUsable(
  cache: ReadonlyMap<string, AgyNodeProbeRecord>,
  proxies: readonly AgyProxyRecord[]
): number {
  return proxies.filter(
    (proxy) => cache.get(computeProxyNodeFingerprint(proxy))?.usable === true
  ).length
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
async function convergeAgyProvider(
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

/** 切换选择并让旧出口立即失效；当前已经是目标节点时不做任何动作。 */
async function selectAgyNode(ordered: readonly string[], preferred?: string | null): Promise<void> {
  if (ordered.length === 0) {
    return
  }
  const target = preferred && ordered.includes(preferred) ? preferred : ordered[0]
  const before = await currentAgySelection()
  if (before === target) {
    return
  }
  const switched = await mihomoChangeProxy(AGY_DEDICATED_GROUP_NAME, target).catch(() => false)
  if (!switched) {
    return
  }
  rememberSelection(target)
  await closeAgyConnections().catch(() => undefined)
}

let probeInFlight = false
/** 连续全灭轮次 → 用于指数退避，避免在 Google 的冷却窗口里越试越久。 */
let consecutiveEmptyRounds = 0
/** 只拦修复扫描；pin 就地复测必须保持固定节奏，否则节点坏了也发现不了。 */
let repairSkipUntilMs = 0
let pinUnknownStreak = 0
let agyState: 'healthy' | 'repairing' | 'exhausted' = 'healthy'

/** 代理页展示用的内存快照：只包含「最近一次真实 agy 请求成功」的节点，避免回读磁盘/重建订阅。 */
const agyProbeSnapshot = new Map<string, AgyProbeSample>()

/** 最近一次真实探测的结论（含失败），用于把"未测"与"探测失败"区分开。 */
const agyLastAttempts = new Map<
  string,
  { state: 'usable' | 'unusable' | 'failed'; reason?: string; checkedAt: number }
>()

function recordAgyAttempt(
  node: string,
  state: 'usable' | 'unusable' | 'failed',
  reason?: string
): void {
  const name = node.trim()
  if (!name) {
    return
  }
  agyLastAttempts.set(name, { state, reason, checkedAt: Date.now() })
}

/** 修复扫描的「本轮已试」记录：超时不会写缓存，必须单独记时间，否则下一轮会重复同一批节点。 */
const agyRepairAttempts = new Map<string, number>()

const REPAIR_ATTEMPT_RETENTION_MS = 60 * 60 * 1000

function pruneRepairAttempts(nowMs: number): void {
  for (const [fingerprint, attemptedAt] of agyRepairAttempts) {
    if (nowMs - attemptedAt > REPAIR_ATTEMPT_RETENTION_MS) {
      agyRepairAttempts.delete(fingerprint)
    }
  }
}

export function getSparkleAgyProbeSnapshot(): AgyProbeSnapshot {
  return Object.fromEntries(agyProbeSnapshot)
}

function syncAgyProbeSnapshot(
  cache: ReadonlyMap<string, AgyNodeProbeRecord>,
  proxies: readonly AgyProxyRecord[]
): void {
  const next = new Map<string, AgyProbeSample>()

  for (const [name, sample] of Object.entries(buildAgyProbeSnapshot(proxies, cache))) {
    next.set(name, { ...sample, state: 'usable' })
  }

  // 已确认锁区（400 location）的节点：有记录就展示真实结论，而不是笼统的"未测"。
  for (const proxy of proxies) {
    const name = String(proxy.name ?? '').trim()
    if (!name) {
      continue
    }
    const record = cache.get(computeProxyNodeFingerprint(proxy))
    if (!record || record.usable) {
      continue
    }
    const current = next.get(name)
    if (!current || record.checkedAt >= current.checkedAt) {
      next.set(name, {
        rttMs: record.rttMs,
        checkedAt: record.checkedAt,
        state: 'unusable',
        reason: '地区不支持'
      })
    }
  }

  // 最近一次探测失败（超时/网络/CLI 不可用）：比已有样本新才覆盖。
  for (const [name, attempt] of agyLastAttempts) {
    if (attempt.state === 'usable') {
      continue
    }
    const current = next.get(name)
    if (current && attempt.checkedAt < current.checkedAt) {
      continue
    }
    next.set(name, {
      rttMs: 0,
      checkedAt: attempt.checkedAt,
      state: attempt.state,
      reason: attempt.reason
    })
  }

  agyProbeSnapshot.clear()
  for (const [name, sample] of next) {
    agyProbeSnapshot.set(name, sample)
  }
}

function recordPinOutcome(
  cache: Map<string, AgyNodeProbeRecord>,
  proxy: AgyProxyRecord,
  outcome: AgyAuditOutcome
): boolean {
  const fingerprint = computeProxyNodeFingerprint(proxy)
  const previous = cache.get(fingerprint)
  const usable = outcome.verdict === 'usable'
  cache.set(fingerprint, {
    usable,
    rttMs: outcome.rttMs,
    checkedAt: Date.now()
  })
  return !previous || previous.usable !== usable
}

export async function bootstrapSparkleAgyProvider(): Promise<void> {
  if (probeInFlight) {
    return
  }
  probeInFlight = true
  try {
    const { current } = await getProfileConfig()
    if (!current || current === 'default') {
      return
    }
    const profile = await getProfile(current)
    const proxies = extractProxies(profile) as AgyProxyRecord[]
    if (proxies.length === 0) {
      return
    }

    const { proxySwitchPriority = [] } = await getAppConfig()
    const regionPriority = resolveEffectiveRegionPriority(proxySwitchPriority)
    const cache = await loadSparkleAgyProbeCache()
    syncAgyProbeSnapshot(cache, proxies)

    // 组未生成（无候选节点）时既没有可探测的出口，也不能热重载一个不存在的 provider。
    const group = await mihomoGroupDetail(AGY_DEDICATED_GROUP_NAME).catch(() => undefined)
    if (!group) {
      return
    }

    const model = AGY_PROBE_MODEL

    const pinName = String(group.now ?? '').trim() || null
    const pinProxy = pinName
      ? proxies.find((proxy) => String(proxy.name ?? '').trim() === pinName)
      : undefined

    // ① pin 就地复测：不切组、不关连接、不影响正在进行的会话。
    // 400 可能是账号轮转造成的：同节点再确认一次，两次都 400 才认定节点被拒；
    // 超时不复测，按轮次累计（上游整体变慢时不能把生产出口每 3 分钟拖去扫一遍）。
    let pinVerdict: AgyProbeVerdict | null = null
    if (pinName && pinProxy) {
      let outcome = await probeSingleNode(pinName, model, PIN_PROBE_TIMEOUT_MS)
      if (outcome.fatal) {
        return
      }
      if (outcome.verdict === 'unusable') {
        outcome = await probeSingleNode(pinName, model, PIN_PROBE_TIMEOUT_MS)
        if (outcome.fatal) {
          return
        }
      }
      if (outcome.verdict !== 'unknown') {
        const changed = recordPinOutcome(cache, pinProxy, outcome)
        if (changed) {
          await saveSparkleAgyProbeCache(cache)
        }
      }
      syncAgyProbeSnapshot(cache, proxies)
      pinVerdict = outcome.verdict
      pinUnknownStreak = outcome.verdict === 'unknown' ? pinUnknownStreak + 1 : 0
    } else {
      pinUnknownStreak = 0
    }

    const verifiedCount = countUsable(cache, proxies)
    const needsRepair = shouldRepairAgyPin({ pinVerdict, unknownStreak: pinUnknownStreak })

    if (!needsRepair) {
      // pin 实测可用才收敛 provider：不健康时保持现状，交给下面的修复扫描。
      const ordered = await convergeAgyProvider(proxies, regionPriority, cache)
      await selectAgyNode(ordered, pinName)
      consecutiveEmptyRounds = 0
      repairSkipUntilMs = 0
      if (agyState !== 'healthy') {
        await appendAppLog(
          `[SparkleAgyProbe]: pin ${pinName ?? 'n/a'} healthy again, pool=${ordered.length}\n`
        )
        agyState = 'healthy'
      }
      return
    }

    if (Date.now() < repairSkipUntilMs) {
      return
    }

    if (agyState !== 'repairing') {
      await appendAppLog(
        `[SparkleAgyProbe]: pin ${pinName ?? 'n/a'} verdict=${pinVerdict ?? 'none'} streak=${pinUnknownStreak} verified=${verifiedCount} model=${model}, repair start\n`
      )
      agyState = 'repairing'
    }

    // ② 修复扫描：先扩 provider 让所有候选都能被切到（此时不改选择，线上出口不变）。
    const expanded = await convergeAgyProvider(proxies, regionPriority, undefined)
    if (expanded.length === 0) {
      return
    }
    pruneRepairAttempts(Date.now())
    const candidates = orderAgyRepairProxies(
      proxies,
      regionPriority,
      cache,
      MAX_PROBES_PER_REPAIR,
      Date.now(),
      agyRepairAttempts
    ).filter((proxy) => String(proxy.name ?? '').trim() !== pinName)
    const audit = await runAgyAudit(
      {
        pending: candidates,
        cache,
        budgetMs: REPAIR_BUDGET_MS,
        stopOnUsable: true,
        attempted: agyRepairAttempts
      },
      { probeNode: (nodeName) => probeSingleNode(nodeName, model, REPAIR_PROBE_TIMEOUT_MS) }
    )

    if (audit.probed > 0) {
      await saveSparkleAgyProbeCache(cache)
    }
    // 失败（unknown）不写缓存，但必须反映到 UI，避免整页"未测"造成误解。
    syncAgyProbeSnapshot(cache, proxies)

    // 巡检跨了几分钟，期间可能已经切订阅：用旧 profile 的节点写 provider 会污染新配置。
    const latest = await getProfileConfig()
    if (latest.current !== current) {
      return
    }

    const ordered = await convergeAgyProvider(proxies, regionPriority, cache)
    if (audit.usableNode) {
      await selectAgyNode(ordered, audit.usableNode)
      consecutiveEmptyRounds = 0
      repairSkipUntilMs = 0
      agyState = 'healthy'
      await appendAppLog(
        `[SparkleAgyProbe]: repaired pin ${pinName ?? 'n/a'} -> ${audit.usableNode} probed=${audit.probed} usable=${audit.usable} pool=${ordered.length}\n`
      )
      return
    }

    // 全灭：保持原 pin（没有证据表明别的节点更好），并拉长下一轮修复间隔。
    await selectAgyNode(ordered, pinName)
    consecutiveEmptyRounds += 1
    repairSkipUntilMs =
      Date.now() + resolveAgyAuditBackoffMs(PIN_CHECK_INTERVAL_MS, consecutiveEmptyRounds)
    agyState = 'exhausted'
    await appendAppLog(
      `[SparkleAgyProbe]: WARN no node passed the real agy check (probed=${audit.probed}); keep ${pinName ?? 'none'} empty_rounds=${consecutiveEmptyRounds}\n`
    )
  } catch (error) {
    await appendAppLog(
      `[SparkleAgyProbe]: error=${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    probeInFlight = false
  }
}

let agyProbeTimer: NodeJS.Timeout | undefined

export function startSparkleAgyProbeLoop(): void {
  if (agyProbeTimer) {
    return
  }
  agyProbeTimer = setInterval(() => {
    bootstrapSparkleAgyProvider().catch(() => undefined)
  }, PIN_CHECK_INTERVAL_MS)
  agyProbeTimer.unref()
}
