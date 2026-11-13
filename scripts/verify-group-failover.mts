#!/usr/bin/env tsx
// [INPUT] groupFailoverCore::FailoverGroupSnapshot (POS: 故障转移纯决策层) ·
//         groupFailoverEngine::createGroupFailoverEngine (POS: 故障转移编排引擎) ·
//         mihomoGroupMembersCore::buildProviderProxyLookup/resolveGroupMemberProxies (POS: 分组成员解析) ·
//         mihomoIsolatedHarness::closeServer/openAlertStream/proxiedGet/reserveFreePorts… (POS: 隔离内核端到端夹具)
// [OUTPUT] pnpm run verify:failover [内核路径]: 退出码 0 = 引擎与内核的契约成立
// [POS] 故障转移引擎对真实 mihomo 内核的端到端校验（隔离实例，约 2 分钟）。内核告警文案或拨号失败语义变化时在第一步失败；只接触自己创建的进程、端口与目录。

/**
 * 故障转移引擎 × 真实 mihomo 内核的端到端校验。
 * 隔离实例（项目缓存目录 + 随机回环端口），不接触正在运行的内核。
 *
 * 复现生产故障形态：url-test 组当前节点「探测 URL 可达、真实流量拨号失败」。
 *   flaky-a：只放行探测域名，其余目标在 SOCKS 握手中途断开 → 探测通过、真实流量失败，且被内核计为拨号失败
 *   good-b ：全部放行但应答慢 120 ms → 探测延迟更高，url-test 仍选中 flaky-a
 *
 * 断言：连续两条计数告警 → 改选 good-b 且真实流量恢复 → 保留期满释放固定 → 用户固定的节点不被覆盖。
 * 升级或切换内核（含 alpha）后运行：pnpm run verify:failover [内核路径]，约 2 分钟。
 * 内核告警措辞或拨号失败语义变化时，本脚本在第一步失败。
 */
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type WebSocket from 'ws'
import type { FailoverGroupSnapshot } from '../src/main/core/groupFailoverCore'
import {
  closeServer,
  openAlertStream,
  proxiedGet,
  reserveFreePorts,
  say,
  startHttpTarget,
  startMihomo,
  startSocksNode,
  waitFor,
  type RunningCore
} from './mihomoIsolatedHarness'

// scripts/ 是 ESM 包而 src/ 是 CJS 包：具名 import 在运行时取不到导出，故经 CJS require 加载（类型仍取自源码）。
const requireSource = createRequire(import.meta.url)
const { DIAL_FAILURE_DEDUPE_MS, FAILOVER_HOLD_MS, parseDialFailureGroup, toFailoverSnapshot } =
  requireSource(
    '../src/main/core/groupFailoverCore'
  ) as typeof import('../src/main/core/groupFailoverCore')
const { createGroupFailoverEngine } = requireSource(
  '../src/main/core/groupFailoverEngine'
) as typeof import('../src/main/core/groupFailoverEngine')
const { buildProviderProxyLookup, resolveGroupMemberProxies } = requireSource(
  '../src/main/core/mihomoGroupMembersCore'
) as typeof import('../src/main/core/mihomoGroupMembersCore')

const ROOT = path.resolve(import.meta.dirname, '..')
/** 名称命中策略表的 failover 角色。 */
const GROUP = 'Sparkle-台湾'
const PROBE_HOST = 'probe.test'
const REAL_HOST = 'real.test'
const PROBE_URL = `http://${PROBE_HOST}/`
/** 距上一条告警满去重间隔，保证下一条告警被引擎计数。 */
const QUIET_MS = DIAL_FAILURE_DEDUPE_MS + 1_000
const FAILURE_BURST_SIZE = 10
const STEP_TIMEOUT_MS = 10_000

interface Ports {
  controller: number
  mixed: number
  flaky: number
  good: number
  probeTarget: number
  realTarget: number
}

interface ScheduledTask {
  run: () => void
  delayMs: number
}

interface FailoverRig {
  engineLog: string[]
  scheduled: ScheduledTask[]
  /** 制造一条会被引擎计数的内核告警（先静默满去重间隔），返回这批真实请求的状态码。 */
  countedFailure: () => Promise<number[]>
  /** 等引擎日志出现指定片段。 */
  engineLogged: (text: string) => Promise<void>
}

function buildConfig(ports: Ports): string {
  return [
    `mixed-port: ${ports.mixed}`,
    `external-controller: 127.0.0.1:${ports.controller}`,
    'allow-lan: false',
    'mode: rule',
    'log-level: info',
    'ipv6: false',
    'proxies:',
    `  - { name: flaky-a, type: socks5, server: 127.0.0.1, port: ${ports.flaky} }`,
    `  - { name: good-b, type: socks5, server: 127.0.0.1, port: ${ports.good} }`,
    'proxy-groups:',
    `  - { name: ${GROUP}, type: url-test, proxies: [flaky-a, good-b], url: '${PROBE_URL}', interval: 3600, tolerance: 0, lazy: false }`,
    'rules:',
    `  - MATCH,${GROUP}`
  ].join('\n')
}

async function groupState(core: RunningCore): Promise<{ now: string; fixed: string }> {
  const group = await core.getJson<ControllerGroupDetail>(`/proxies/${encodeURIComponent(GROUP)}`)
  return { now: group.now, fixed: group.fixed ?? '' }
}

/** 与 mihomoApi.mihomoGroups 一致：成员由 /proxies 与 provider 合并解析，testUrl 取组配置的探测地址。 */
async function loadGroup(
  core: RunningCore,
  name: string
): Promise<FailoverGroupSnapshot | undefined> {
  const { proxies } = await core.getJson<ControllerProxies>('/proxies')
  const group = proxies[name]
  if (!group || !('all' in group)) {
    return undefined
  }
  const lookup = buildProviderProxyLookup(
    await core.getJson<ControllerProxyProviders>('/providers/proxies')
  )
  const all = resolveGroupMemberProxies(group.all, proxies, lookup)
  return toFailoverSnapshot({ ...group, testUrl: PROBE_URL, all })
}

/** 真实引擎 + 真实告警流 + 真实控制器读写；定时器被捕获，由场景决定何时到期。 */
function createRig(core: RunningCore, alerts: WebSocket, ports: Ports): FailoverRig {
  const engineLog: string[] = []
  const alertTimes: number[] = []
  const scheduled: ScheduledTask[] = []

  createGroupFailoverEngine({
    subscribeAlerts: (listener) => {
      const onMessage = (data: WebSocket.RawData): void => {
        const log = JSON.parse(data.toString()) as ControllerLog
        if (parseDialFailureGroup(log) !== undefined) {
          alertTimes.push(Date.now())
        }
        listener(log)
      }
      alerts.on('message', onMessage)
      return () => alerts.off('message', onMessage)
    },
    loadGroup: (name) => loadGroup(core, name),
    pinNode: async (group, node) => {
      const result = await core.request('PUT', `/proxies/${encodeURIComponent(group)}`, {
        name: node
      })
      return result.status === 204
    },
    unpinNode: async (group) => {
      await core.request('DELETE', `/proxies/${encodeURIComponent(group)}`)
    },
    log: async (line) => {
      engineLog.push(line.trim())
      say(`引擎 ${line.trim()}`)
    },
    now: Date.now,
    schedule: (run, delayMs) => {
      const task = { run, delayMs }
      scheduled.push(task)
      return () => {
        const index = scheduled.indexOf(task)
        if (index >= 0) {
          scheduled.splice(index, 1)
        }
      }
    }
  }).start()

  async function countedFailure(): Promise<number[]> {
    const lastAlertAt = alertTimes[alertTimes.length - 1]
    if (lastAlertAt !== undefined) {
      await sleep(Math.max(0, lastAlertAt + QUIET_MS - Date.now()))
    }
    const seen = alertTimes.length
    const statuses = await Promise.all(
      Array.from({ length: FAILURE_BURST_SIZE }, () => proxiedGet(ports.mixed, REAL_HOST))
    )
    await waitFor(() => alertTimes.length > seen, STEP_TIMEOUT_MS, '内核发出「连续拨号失败」告警')
    return statuses
  }

  const engineLogged = (text: string): Promise<void> =>
    waitFor(
      () => engineLog.some((line) => line.includes(text)),
      STEP_TIMEOUT_MS,
      `引擎日志 ${text}`
    )

  return { engineLog, scheduled, countedFailure, engineLogged }
}

async function runScenario(core: RunningCore, alerts: WebSocket, ports: Ports): Promise<void> {
  const { version } = JSON.parse((await core.request('GET', '/version')).text) as ControllerVersion
  say(`内核 ${version} 就绪`)

  // 前置条件：成员探测都通过，url-test 选中更快的 flaky-a，而它对真实流量失败。
  const probe = await core.request(
    'GET',
    `/group/${encodeURIComponent(GROUP)}/delay?url=${encodeURIComponent(PROBE_URL)}&timeout=3000`
  )
  assert.equal(probe.status, 200, '组测速应成功')
  assert.equal((await groupState(core)).now, 'flaky-a', 'url-test 应选中探测更快的 flaky-a')
  assert.notEqual(await proxiedGet(ports.mixed, REAL_HOST), 200, 'flaky-a 对真实流量应失败')
  say('前置条件成立：探测通过、真实流量失败')

  const rig = createRig(core, alerts, ports)

  say('阶段 1：两条相隔 ≥30 s 的计数告警 → 改选')
  const beforeSwitch = await rig.countedFailure()
  assert.ok(
    beforeSwitch.every((status) => status !== 200),
    '改选前故障节点上的真实流量应失败'
  )
  assert.ok(!rig.engineLog.some((line) => line.includes('switched')), '首条计数告警只累计')
  const duringSwitch = await rig.countedFailure()
  await rig.engineLogged(`switched group=${GROUP} from=flaky-a to=good-b`)
  // 内核对每条连接最多重拨 10 次，改选在重拨窗口内生效时在途请求会被救回；数量随时序变化，仅作观察输出。
  say(
    `在途请求被救回：${duringSwitch.filter((status) => status === 200).length}/${duringSwitch.length}`
  )
  assert.deepEqual(await groupState(core), { now: 'good-b', fixed: 'good-b' })
  const recovered = await Promise.all(
    Array.from({ length: 3 }, () => proxiedGet(ports.mixed, REAL_HOST))
  )
  assert.deepEqual(recovered, [200, 200, 200], '改选后真实流量应恢复')
  assert.deepEqual(
    rig.scheduled.map((task) => task.delayMs),
    [FAILOVER_HOLD_MS],
    '改选后应登记一次保留期满释放'
  )

  say('阶段 1b：保留期满 → 交还内核')
  rig.scheduled[0].run()
  await rig.engineLogged(`released group=${GROUP} node=good-b`)
  assert.equal((await groupState(core)).fixed, '', '保留期满应解除固定')

  say('阶段 2：用户固定的节点不被覆盖')
  const pin = await core.request('PUT', `/proxies/${encodeURIComponent(GROUP)}`, {
    name: 'flaky-a'
  })
  assert.equal(pin.status, 204)
  assert.equal((await groupState(core)).fixed, 'flaky-a')
  const pinnedBursts = [...(await rig.countedFailure()), ...(await rig.countedFailure())]
  await rig.engineLogged(`skipped group=${GROUP} reason=user-pin node=flaky-a`)
  assert.ok(
    pinnedBursts.every((status) => status !== 200),
    '用户固定期间引擎不得绕开故障节点'
  )
  assert.equal((await groupState(core)).fixed, 'flaky-a', '引擎不得改动用户固定')
}

async function main(): Promise<void> {
  const binary = path.resolve(
    process.argv[2] ??
      process.env.SPARKLE_FAILOVER_E2E_CORE ??
      path.join(ROOT, 'extra/sidecar/mihomo')
  )
  if (!existsSync(binary)) {
    throw new Error(`内核不存在：${binary}（先执行 pnpm run prepare，或传入内核路径）`)
  }
  process.once('SIGINT', () => process.exit(130))

  const [controller, mixed, flaky, good, probeTarget, realTarget] = await reserveFreePorts(6)
  const ports: Ports = { controller, mixed, flaky, good, probeTarget, realTarget }
  const targets = new Map([
    [PROBE_HOST, probeTarget],
    [REAL_HOST, realTarget]
  ])
  const servers = await Promise.all([
    startHttpTarget(probeTarget, 204, ''),
    startHttpTarget(realTarget, 200, 'real-ok'),
    startSocksNode(flaky, targets, (host) => host === PROBE_HOST, 0),
    startSocksNode(good, targets, () => true, 120)
  ])

  const workDir = path.join(ROOT, 'node_modules/.cache/verify-failover', String(process.pid))
  let core: RunningCore | undefined
  let alerts: WebSocket | undefined
  try {
    core = await startMihomo({
      binary,
      workDir,
      config: buildConfig(ports),
      controllerPort: controller
    })
    alerts = await openAlertStream(controller)
    await runScenario(core, alerts, ports)
    say('E2E PASS')
  } catch (error) {
    if (core) {
      console.error(`--- 内核输出（末 25 行）---\n${core.outputTail(25)}`)
    }
    throw error
  } finally {
    alerts?.close()
    await core?.stop()
    await Promise.all(servers.map(closeServer))
    rmSync(workDir, { recursive: true, force: true })
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('E2E FAIL:', error)
    process.exit(1)
  }
)
