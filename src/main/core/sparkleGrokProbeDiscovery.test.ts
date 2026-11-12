// [INPUT] sparkleGrokProbe（经 sparkleGrokProbeRig 装配：假 axios / mihomo / 配置，真实临时文件）
// [OUTPUT] 冷启动与发现阶段的行为断言
// [POS] 没有任何验证结论时（缓存为空）怎么选出 `grok 专用` 的可用节点：验证顺序、停止条件、候选池与选择结果、失败后的退避。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CANDIDATES,
  advance,
  HK1,
  JP1,
  NOW,
  SECOND_MS,
  TW1,
  US1,
  assertLog,
  assertNoLog,
  cacheFileExists,
  cacheKey,
  challenge,
  makeNodes,
  nameOf,
  networkFailure,
  ok,
  readCache,
  readProviderMembers,
  runBootstrap,
  setNow,
  skipPoolRefresh,
  useGrokRig,
  world,
  writeCache
} from './sparkleGrokProbeRig'

describe('sparkleGrokProbe：没有订阅或读不到订阅', () => {
  const grok = useGrokRig()

  it('没有当前订阅、默认配置或没有节点时什么都不做', async () => {
    for (const setup of [
      () => {
        world.profile = {}
      },
      () => {
        world.profile = { current: 'default' }
      },
      () => {
        world.profileProxies = []
      }
    ]) {
      world.profile = { current: 'p1' }
      world.profileProxies = [TW1]
      setup()
      await runBootstrap(grok())
    }

    assert.deepEqual(world.calls, [])
    assert.equal(world.requests.length, 0)
    assert.equal(cacheFileExists(), false)
    assert.equal(world.logs.length, 0)
  })

  it('读订阅失败只记一条日志，下一轮照常运行', async () => {
    world.profileFailure = { reason: new Error('profile unreadable') }
    await runBootstrap(grok())
    world.profileFailure = { reason: 'plain failure' }
    await runBootstrap(grok())
    assert.deepEqual(world.logs, [
      '[SparkleGrokProbe]: error=profile unreadable\n',
      '[SparkleGrokProbe]: error=plain failure\n'
    ])

    world.profileFailure = undefined
    await runBootstrap(grok())
    assert.equal(world.requests.length > 0, true)
  })
})

describe('sparkleGrokProbe：冷启动发现', () => {
  const grok = useGrokRig()
  const via = (): string[] => world.requests.map((request) => request.via)

  it('逐个真实请求验证，凑够 3 个可用就停，池子按真实 RTT 升序并切到最快的', async () => {
    world.routedByNode = { '台湾-1': ok(300), '日本-1': ok(120), '美国-1': ok(200) }

    await runBootstrap(grok())

    assert.deepEqual(via(), ['台湾-1', '日本-1', '美国-1'])
    assert.deepEqual(readProviderMembers(), ['日本-1', '美国-1', '台湾-1'])
    assert.deepEqual(world.members, ['日本-1', '美国-1', '台湾-1'])
    assert.equal(world.selection, '日本-1')
    assert.deepEqual(world.calls, [
      'detail:grok 专用',
      'update:sparkle-grok',
      'change:台湾-1',
      'close:grok 专用',
      'change:日本-1',
      'close:grok 专用',
      'change:美国-1',
      'close:grok 专用',
      'update:sparkle-grok',
      'change:日本-1',
      'close:grok 专用'
    ])
    assert.deepEqual(readCache(), {
      [cacheKey(TW1)]: { alive: true, rttMs: 300, checkedAt: NOW + 300, status: 200 },
      [cacheKey(JP1)]: { alive: true, rttMs: 120, checkedAt: NOW + 420, status: 200 },
      [cacheKey(US1)]: { alive: true, rttMs: 200, checkedAt: NOW + 620, status: 200 }
    })
    assertLog('discovery probed=3 working=3 pool=3')
    assertLog('initial selection=日本-1')
    assertNoLog('WARN')
  })

  it('非香港节点全都不行时才轮到香港，失败原因如实记入缓存与日志', async () => {
    world.defaultRouted = challenge()
    world.routedByNode = { '香港-1': ok(90) }

    await runBootstrap(grok())

    assert.deepEqual(via(), CANDIDATES)
    assert.equal(world.selection, '香港-1')
    assert.deepEqual(readProviderMembers(), ['香港-1'])
    const cache = readCache()
    assert.deepEqual(cache[cacheKey(TW1)], {
      alive: false,
      rttMs: 0,
      checkedAt: NOW + 5,
      status: 403,
      reason: 'HTTP 403 cf-mitigated=challenge'
    })
    assert.equal(cache[cacheKey(HK1)].alive, true)
    assertLog('node=台湾-1 routed failed HTTP 403 cf-mitigated=challenge (5ms)')
    assertLog('discovery probed=5 working=1 pool=1')
  })

  it('网络失败（状态 0）同样判失败，原因取自错误信息；非 Error 的拒绝用字符串形式', async () => {
    world.routedQueue = [networkFailure('socket hang up', 30), { kind: 'failure', error: 'boom' }]
    world.defaultRouted = challenge()

    await runBootstrap(grok())

    const cache = readCache()
    assert.deepEqual(cache[cacheKey(TW1)], {
      alive: false,
      rttMs: 0,
      checkedAt: NOW + 30,
      status: 0,
      reason: 'socket hang up'
    })
    assert.equal(cache[cacheKey(JP1)].reason, 'boom')
    assertLog('node=台湾-1 routed failed socket hang up (30ms)')
    assertLog('node=日本-1 routed failed boom (5ms)')
  })

  it('切换被拒绝的节点没有结论：不写缓存，但占用一个探测名额', async () => {
    world.changeRefused = new Set(['台湾-1'])

    await runBootstrap(grok())

    assert.deepEqual(via(), ['日本-1', '美国-1', '新加坡-1'])
    assert.equal(cacheKey(TW1) in readCache(), false)
    assertLog('discovery probed=4 working=3 pool=3')
  })

  it('切换时 mihomo 接口报错：当作没切成，不发请求、不写结论，也不让这一轮出错', async () => {
    world.changeFailure = true

    await runBootstrap(grok())

    assert.equal(world.requests.length, 0)
    assert.deepEqual(readCache(), {})
    assertLog('discovery probed=5 working=0')
    assertNoLog('error=')
  })

  it('关闭旧连接失败不影响验证与选择', async () => {
    world.closeFailure = true

    await runBootstrap(grok())

    assert.equal(world.selection !== undefined, true)
    assertLog('discovery probed=3 working=3 pool=3')
  })

  it('单轮最多验证 6 个候选', async () => {
    const nodes = makeNodes(8)
    world.profileProxies = nodes
    world.defaultRouted = challenge()

    await runBootstrap(grok())

    assert.deepEqual(via(), nodes.slice(0, 6).map(nameOf))
    assertLog('discovery probed=6 working=0')
  })

  it('单轮预算（10 分钟）一到点就停，已测结果照常保存', async () => {
    world.profileProxies = makeNodes(8)
    world.defaultRouted = networkFailure('timeout', 200 * SECOND_MS)

    await runBootstrap(grok())

    // 第 3 次验证结束时刚好 600 秒，等于预算，不再开始第 4 次。
    assert.equal(world.requests.length, 3)
    assertLog('discovery probed=3 working=0')
    assert.equal(Object.keys(readCache()).length, 3)
  })

  it('同名节点只验证一次，没有名字的节点跳过', async () => {
    const duplicate = { ...TW1, server: 'other.example.com' }
    world.profileProxies = [TW1, duplicate, { type: 'ss', server: 'x.example.com', port: 1 }, JP1]

    await runBootstrap(grok())

    assert.deepEqual(via(), ['台湾-1', '日本-1'])
    assertLog('discovery probed=2 working=2 pool=2')
  })

  it('重载 provider 失败只记一次日志，发现照常完成', async () => {
    world.updateFailure = { reason: new Error('mihomo unavailable') }

    await runBootstrap(grok())

    const failures = world.logs.filter((line) => line.includes('provider reload failed'))
    assert.deepEqual(failures, [
      '[SparkleGrokProbe]: provider reload failed err=mihomo unavailable\n'
    ])
    assertLog('discovery probed=3 working=3 pool=3')
  })
})

describe('sparkleGrokProbe：发现失败后的退避', () => {
  const grok = useGrokRig()

  it('一个都没验证通过：记空轮并选不出节点', async () => {
    world.defaultRouted = challenge()

    await runBootstrap(grok())

    assertLog('discovery probed=5 working=0')
    assertLog('WARN discovery found nothing (empty_rounds=1)')
    assertLog('initial selection=none')
    assert.equal(Object.keys(readCache()).length, 5)
  })

  it('退避期内只复核当前节点，不再扫描候选', async () => {
    world.defaultRouted = challenge()
    await runBootstrap(grok())
    const requestsAfterFirstRound = world.requests.length

    advance(30 * SECOND_MS)
    await runBootstrap(grok())

    assert.equal(world.requests.length, requestsAfterFirstRound + 1)
    assertLog('pin failed, repair backoff 30s remaining (empty_rounds=1)')
  })

  it('冷启动选出节点后，之前累计的空轮次与退避一并清零', async () => {
    world.defaultRouted = challenge()
    await runBootstrap(grok())
    assertLog('WARN discovery found nothing (empty_rounds=1)')

    // 缓存被清空：下一轮又是冷启动（不受退避约束），这次选出了节点。
    writeCache({})
    skipPoolRefresh()
    world.defaultRouted = ok()
    advance(10 * SECOND_MS)
    await runBootstrap(grok())
    assertLog('discovery probed=3 working=3 pool=3')

    // 之后全灭：应当从第 1 轮计起，并且立刻扫描，而不是还困在旧的退避里。
    world.defaultRouted = challenge()
    advance(10 * SECOND_MS)
    await runBootstrap(grok())

    assertLog('WARN no usable node (empty_rounds=1 next_repair_in=60s)')
    assertNoLog('pin failed')
  })

  it('连续全灭时退避按 1×、2×、3× 拉长并封顶在 3×，到点才再次扫描', async () => {
    world.defaultRouted = challenge()
    world.groupDelayTakesMs = 0
    await runBootstrap(grok())
    let roundEndedAt = Date.now()

    for (const [emptyRounds, backoffMs] of [
      [1, 60 * SECOND_MS],
      [2, 120 * SECOND_MS],
      [3, 180 * SECOND_MS],
      [4, 180 * SECOND_MS]
    ]) {
      const before = world.requests.length
      // 复核当前节点的请求要花 5ms：差 1ms 到点，仍在退避期，只复核当前节点。
      setNow(roundEndedAt + backoffMs - 6)
      await runBootstrap(grok())
      assert.equal(world.requests.length - before, 1, `第 ${emptyRounds} 档退避未到点`)

      // 刚好到点：复核当前节点后扫描池内其余 4 个，再发现阶段验证 5 个。
      setNow(roundEndedAt + backoffMs - 5)
      await runBootstrap(grok())
      assert.equal(world.requests.length - before, 1 + 1 + 4 + 5, `第 ${emptyRounds} 档退避到点`)
      roundEndedAt = Date.now()
    }

    const waits = world.logs.filter((line) => line.includes('next_repair_in'))
    assert.deepEqual(
      waits.map((line) => /empty_rounds=(\d+) next_repair_in=(\d+)s/.exec(line)?.slice(1)),
      [
        ['2', '120'],
        ['3', '180'],
        ['4', '180'],
        ['5', '180']
      ]
    )
  })
})
