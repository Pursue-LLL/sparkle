// [INPUT] sparkleGrokProbe（经 sparkleGrokProbeRig 装配：假 axios / mihomo / 配置，真实临时文件）
// [OUTPUT] 真实请求口径、缓存读取、展示快照、单轮互斥与循环的行为断言
// [POS] 探针里不属于选路流程本身的几块：HEAD 请求怎么发、怎么判、缓存文件怎么读、代理页快照怎么来、循环怎么启停。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { spyOnTimer } from './timerSpyHarness'
import {
  JP1,
  MINUTE_MS,
  NOW,
  SECOND_MS,
  TW1,
  US1,
  advance,
  assertLog,
  cacheKey,
  cacheRecord,
  challenge,
  HANG,
  loadCache,
  ok,
  readCache,
  runBootstrap,
  setNow,
  settle,
  skipPoolRefresh,
  snapshot,
  useGrokRig,
  world,
  writeCache,
  writeCacheRaw,
  type Routed
} from './sparkleGrokProbeRig'

/** 只有台湾-1 一个节点：冷启动就是发一次请求，便于观察这次请求本身。 */
function singleNodeWorld(): void {
  world.profileProxies = [TW1]
}

describe('sparkleGrokProbe：请求格式', () => {
  const grok = useGrokRig()

  it('经 mixed-port 以 HEAD 请求 grok.com，任何状态码都当作应答而不是异常', async () => {
    singleNodeWorld()

    await runBootstrap(grok())

    const { config } = world.requests[0]
    assert.equal(config.method, 'HEAD')
    assert.equal(config.url, 'https://grok.com/')
    assert.equal(config.timeout, 8000)
    assert.deepEqual(config.proxy, { protocol: 'http', host: '127.0.0.1', port: 7890 })
    const validateStatus = config.validateStatus as (status: number) => boolean
    assert.equal(validateStatus(403), true)
    assert.equal(validateStatus(503), true)
    const headers = config.headers as Record<string, string>
    assert.match(headers['User-Agent'], /^Mozilla\/5\.0 .*Chrome\//)
    assert.equal(headers.Accept, 'text/html,application/xhtml+xml')
  })

  for (const [title, controlled, expected] of [
    ['mixed-port 是数字字符串', { 'mixed-port': '7891' }, 7891],
    ['mixed-port 缺失（依赖 TUN 直连）', {}, undefined],
    ['mixed-port 为 0', { 'mixed-port': 0 }, undefined],
    ['mixed-port 为负数', { 'mixed-port': -5 }, undefined],
    ['mixed-port 不是数字', { 'mixed-port': 'abc' }, undefined]
  ] as const) {
    it(`${title}：${expected ? `代理端口取 ${expected}` : '不带代理参数'}`, async () => {
      singleNodeWorld()
      world.controlled = { ...controlled }

      await runBootstrap(grok())

      const { config } = world.requests[0]
      assert.deepEqual(
        config.proxy,
        expected ? { protocol: 'http', host: '127.0.0.1', port: expected } : undefined
      )
      assert.equal('proxy' in config, expected !== undefined)
    })
  }

  it('读不到 mihomo 配置时按没有 mixed-port 处理', async () => {
    singleNodeWorld()
    world.controlledFailure = true

    await runBootstrap(grok())

    assert.equal('proxy' in world.requests[0].config, false)
  })
})

describe('sparkleGrokProbe：可用性判定', () => {
  const grok = useGrokRig()

  for (const [title, routed, alive, reason] of [
    ['200 且没有 cf-mitigated', { kind: 'response', status: 200 }, true, undefined],
    [
      '200 但 cf-mitigated=challenge',
      { kind: 'response', status: 200, cfMitigated: 'challenge' },
      false,
      'HTTP 200 cf-mitigated=challenge'
    ],
    [
      'cf-mitigated 含 challenge（不分大小写）',
      { kind: 'response', status: 200, cfMitigated: 'Managed-CHALLENGE' },
      false,
      'HTTP 200 cf-mitigated=Managed-CHALLENGE'
    ],
    [
      'cf-mitigated 是别的取值',
      { kind: 'response', status: 200, cfMitigated: 'block' },
      true,
      undefined
    ],
    ['403 且没有 cf-mitigated', { kind: 'response', status: 403 }, false, 'HTTP 403'],
    ['重定向不算通过', { kind: 'response', status: 301 }, false, 'HTTP 301'],
    ['5xx', { kind: 'response', status: 503 }, false, 'HTTP 503']
  ] as Array<[string, Routed, boolean, string | undefined]>) {
    it(`${title}：${alive ? '可用' : '不可用'}`, async () => {
      singleNodeWorld()
      world.defaultRouted = routed

      await runBootstrap(grok())

      const record = readCache()[cacheKey(TW1)]
      assert.equal(record.alive, alive)
      assert.equal(record.reason, reason)
      assert.equal(record.rttMs, alive ? 5 : 0)
    })
  }
})

describe('sparkleGrokProbe：读取探测缓存', () => {
  useGrokRig()

  it('完整记录原样读出，包括可选的状态码与失败原因', async () => {
    const alive = { alive: true, rttMs: 120, checkedAt: NOW, status: 200 }
    const dead = { alive: false, rttMs: 0, checkedAt: NOW - 5, status: 403, reason: 'HTTP 403' }
    writeCache({ a: alive, b: dead })

    const cache = await loadCache()

    assert.deepEqual(
      [...cache],
      [
        ['a', alive],
        ['b', dead]
      ]
    )
  })

  it('字段缺失或类型不对的记录整条丢弃，不影响其余记录', async () => {
    writeCacheRaw(
      JSON.stringify({
        nullRecord: null,
        aliveText: { alive: 'yes', rttMs: 1, checkedAt: 1 },
        rttText: { alive: true, rttMs: '1', checkedAt: 1 },
        noTime: { alive: true, rttMs: 1 },
        good: { alive: false, rttMs: 0, checkedAt: 5 }
      })
    )

    const cache = await loadCache()

    assert.deepEqual([...cache.keys()], ['good'])
  })

  it('文件不存在、不是 JSON 或不是对象时得到空缓存', async () => {
    assert.equal((await loadCache()).size, 0)
    writeCacheRaw('{not json')
    assert.equal((await loadCache()).size, 0)
    writeCacheRaw('null')
    assert.equal((await loadCache()).size, 0)
  })
})

describe('sparkleGrokProbe：代理页快照', () => {
  const grok = useGrokRig()

  it('一轮都没跑过时为空', () => {
    assert.deepEqual(snapshot(), {})
  })

  it('每个节点展示最近一次真实请求的结论，失败带状态码与原因', async () => {
    world.routedByNode = { '台湾-1': ok(300), '日本-1': challenge() }
    world.defaultRouted = ok(100)

    await runBootstrap(grok())

    assert.deepEqual(snapshot(), {
      '台湾-1': { rttMs: 300, checkedAt: NOW + 300, state: 'usable', status: 200 },
      '日本-1': {
        rttMs: 0,
        checkedAt: NOW + 305,
        state: 'failed',
        status: 403,
        reason: 'HTTP 403 cf-mitigated=challenge'
      },
      '美国-1': { rttMs: 100, checkedAt: NOW + 405, state: 'usable', status: 200 },
      '新加坡-1': { rttMs: 100, checkedAt: NOW + 505, state: 'usable', status: 200 }
    })
  })

  it('读到的是副本，改动它不影响后续读取', async () => {
    singleNodeWorld()
    await runBootstrap(grok())

    const first = snapshot()
    delete first['台湾-1']
    first['别的节点'] = { rttMs: 1, checkedAt: NOW, state: 'usable' }

    assert.deepEqual(Object.keys(snapshot()), ['台湾-1'])
  })

  it('本轮探测比磁盘缓存新就以探测为准，缓存更新就以缓存为准', async () => {
    seedCache()
    skipPoolRefresh()
    world.routedByNode = { '日本-1': challenge() }
    world.defaultRouted = ok()
    await runBootstrap(grok())
    assert.equal(snapshot()['日本-1'].state, 'failed')

    // 其他途径（如池内延迟刷新）写入了更新的存活结论，而这一轮没再探测它。
    writeCache({
      ...readCache(),
      [cacheKey(JP1)]: { ...cacheRecord(true, 77, 0), checkedAt: NOW + 10 * MINUTE_MS, status: 200 }
    })
    world.defaultRouted = ok()
    advance(61 * SECOND_MS)
    await runBootstrap(grok())

    assert.equal(snapshot()['日本-1'].state, 'usable')
    assert.equal(snapshot()['日本-1'].rttMs, 77)
  })

  it('订阅里已经没有的节点不再出现在快照里', async () => {
    world.defaultRouted = challenge()
    await runBootstrap(grok())
    assert.equal('台湾-1' in snapshot(), true)

    world.profileProxies = [JP1, US1]
    advance(61 * SECOND_MS)
    await runBootstrap(grok())

    assert.equal('台湾-1' in snapshot(), false)
    assert.deepEqual(Object.keys(snapshot()).sort(), ['日本-1', '美国-1'])
  })
})

function seedCache(): void {
  writeCache({
    [cacheKey(JP1)]: cacheRecord(true, 120),
    [cacheKey(US1)]: cacheRecord(true, 200)
  })
}

describe('sparkleGrokProbe：单轮互斥', () => {
  const grok = useGrokRig()

  it('上一轮还在跑（10 分钟内）时直接返回，不重复发起', async () => {
    singleNodeWorld()
    world.routedQueue = [HANG]
    const stuck = grok().bootstrapSparkleGrokProvider()
    await settle()
    const reads = world.profileReads

    advance(10 * MINUTE_MS - 1)
    await grok().bootstrapSparkleGrokProvider()

    assert.equal(world.profileReads, reads)
    assert.equal(world.logs.length, 0)
    void stuck
  })

  it('上一轮卡死超过 10 分钟：记一条日志并强制复位，新一轮照常运行', async () => {
    singleNodeWorld()
    world.routedQueue = [HANG]
    void grok().bootstrapSparkleGrokProvider()
    await settle()

    setNow(NOW + 10 * MINUTE_MS)
    await runBootstrap(grok())

    assertLog('stale pass exceeded budget, resetting')
    assert.equal(readCache()[cacheKey(TW1)].alive, true)
  })
})

describe('sparkleGrokProbe：循环', () => {
  const grok = useGrokRig()

  it('只启动一个 60 秒的定时器，且不阻止进程退出', () => {
    const interval = spyOnTimer('setInterval')
    try {
      grok().startSparkleGrokProbeLoop()
      grok().startSparkleGrokProbeLoop()

      assert.deepEqual(interval.delays, [60 * SECOND_MS])
      assert.equal(interval.unrefs(), 1)
    } finally {
      interval.restore()
    }
  })

  it('每 60 秒跑一轮 bootstrap', async () => {
    grok().startSparkleGrokProbeLoop()
    assert.equal(world.profileReads, 0)

    advance(60 * SECOND_MS)
    await settle()
    assert.equal(world.profileReads, 1)

    advance(60 * SECOND_MS)
    await settle()
    assert.equal(world.profileReads, 2)
  })

  it('某一轮连日志都写不进去也不会让循环崩溃', async () => {
    world.profileFailure = { reason: new Error('profile unreadable') }
    world.logFailure = true
    grok().startSparkleGrokProbeLoop()

    advance(60 * SECOND_MS)
    await settle()

    world.profileFailure = undefined
    world.logFailure = false
    advance(60 * SECOND_MS)
    await settle()
    assert.equal(world.profileReads, 2)
    assert.equal(world.requests.length > 0, true)
  })
})
