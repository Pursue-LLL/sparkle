// [INPUT] sparkleGrokProbe（经 sparkleGrokProbeRig 装配：假 axios / mihomo / 配置，真实临时文件）
// [OUTPUT] 稳态复核与换节点的行为断言
// [POS] 缓存里已有验证结论时每 60 秒做什么：复核当前节点、失败后按池内顺序换节点、池内全灭后重新发现、全灭退避、provider 成员维护。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HK1,
  JP1,
  NOW,
  SECOND_MS,
  SG1,
  TW1,
  US1,
  advance,
  assertLog,
  assertNoLog,
  cacheKey,
  cacheRecord,
  callsStarting,
  challenge,
  makeNodes,
  nameOf,
  networkFailure,
  ok,
  readCache,
  readProviderMembers,
  runBootstrap,
  seedHealthyPool,
  skipPoolRefresh,
  useGrokRig,
  world,
  writeCache,
  writeProviderMembers
} from './sparkleGrokProbeRig'

describe('sparkleGrokProbe：复核当前节点', () => {
  const grok = useGrokRig()
  const via = (): string[] => world.requests.map((request) => request.via)

  it('当前节点通过：只发一次请求并刷新它的 RTT，不动 provider、不切组', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.routedByNode = { '日本-1': ok(150) }

    await runBootstrap(grok())

    assert.deepEqual(via(), ['日本-1'])
    assert.deepEqual(callsStarting('change:'), [])
    assert.deepEqual(callsStarting('close:'), [])
    assert.deepEqual(callsStarting('update:'), [])
    assert.deepEqual(readCache()[cacheKey(JP1)], {
      alive: true,
      rttMs: 150,
      checkedAt: NOW + 150,
      status: 200
    })
    assertLog('selected=日本-1')
  })

  it('网络超时是瞬时的：同一节点等 1 秒再复核一次，通过就不换节点', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.routedQueue = [networkFailure('timeout of 8000ms exceeded', 8000), ok(100)]

    await runBootstrap(grok())

    assert.deepEqual(via(), ['日本-1', '日本-1'])
    assert.deepEqual(callsStarting('change:'), [])
    // 8000ms 超时 + 1000ms 等待 + 100ms 第二次请求
    assert.deepEqual(readCache()[cacheKey(JP1)], {
      alive: true,
      rttMs: 100,
      checkedAt: NOW + 9100,
      status: 200
    })
    assertNoLog('routed failed')
  })

  it('连续两次超时才判当前节点失败，改选池内下一个（当前节点不再被重试）', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.routedQueue = [
      networkFailure('timeout of 8000ms exceeded'),
      networkFailure('timeout of 8000ms exceeded')
    ]

    await runBootstrap(grok())

    assert.deepEqual(via(), ['日本-1', '日本-1', '美国-1'])
    assert.equal(world.selection, '美国-1')
    assert.equal(readCache()[cacheKey(JP1)].alive, false)
    assert.equal(readCache()[cacheKey(JP1)].reason, 'timeout of 8000ms exceeded')
    assertLog('current=日本-1 routed failed timeout of 8000ms exceeded (8000ms)')
    assertLog('selected=美国-1')
  })

  it('403 挑战不是瞬时故障：不重试，直接换节点', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.routedQueue = [challenge()]

    await runBootstrap(grok())

    assert.deepEqual(via(), ['日本-1', '美国-1'])
    assertLog('current=日本-1 routed failed HTTP 403 cf-mitigated=challenge (5ms)')
    assert.equal(world.selection, '美国-1')
  })

  it('换节点时先试池内候选，池子按 RTT 排好且已失败的当前节点不在其中', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.routedQueue = [challenge()]
    world.routedByNode = { '美国-1': challenge(), '台湾-1': ok(60) }

    await runBootstrap(grok())

    assert.deepEqual(via(), ['日本-1', '美国-1', '台湾-1'])
    assert.equal(world.selection, '台湾-1')
    assert.deepEqual(callsStarting('update:'), [])
  })

  it('池内全灭：把 provider 扩到全量重新发现，没试过的优先，选出新节点并收窄 provider', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.defaultRouted = challenge()
    world.routedByNode = { '新加坡-1': ok(80) }

    await runBootstrap(grok())

    // 当前节点 → 池内扫描（美国、台湾）→ 发现阶段：没试过的（日本、新加坡、香港）在前，试过的（台湾、美国）殿后
    assert.deepEqual(via(), [
      '日本-1',
      '美国-1',
      '台湾-1',
      '日本-1',
      '新加坡-1',
      '香港-1',
      '台湾-1',
      '美国-1'
    ])
    assert.equal(world.selection, '新加坡-1')
    assert.deepEqual(world.members, ['新加坡-1'])
    assert.deepEqual(readProviderMembers(), ['新加坡-1'])
    assertLog('discovery probed=5 working=1 pool=1')
    assertLog('selected=新加坡-1')
  })

  it('池内扫描与发现各自最多验证 6 个候选', async () => {
    const nodes = makeNodes(10)
    const names = nodes.map(nameOf)
    world.profileProxies = nodes
    writeCache(
      Object.fromEntries(
        nodes.map((node, index) => [cacheKey(node), cacheRecord(true, 100 + index)])
      )
    )
    writeProviderMembers(names)
    world.members = names
    world.selection = names[0]
    skipPoolRefresh()
    world.defaultRouted = challenge()

    await runBootstrap(grok())

    assert.deepEqual(via(), [
      '线路-01',
      ...['02', '03', '04', '05', '06', '07'].map((serial) => `线路-${serial}`),
      ...['01', '08', '09', '10', '02', '03'].map((serial) => `线路-${serial}`)
    ])
    assertLog('discovery probed=6 working=0')
    assertLog('WARN no usable node (empty_rounds=1 next_repair_in=60s)')
  })

  it('组里查不到当前节点（接口报错）时直接按池内顺序验证', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.groupMissing = true

    await runBootstrap(grok())

    assert.deepEqual(via(), ['日本-1'])
    assert.deepEqual(callsStarting('change:'), ['change:日本-1'])
    assertLog('selected=日本-1')
  })

  it('当前选中的不是订阅里的节点（如 DIRECT）时不复核它，直接换回池内节点', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.members = [...world.members, 'DIRECT']
    world.selection = 'DIRECT'

    await runBootstrap(grok())

    assert.deepEqual(via(), ['日本-1'])
    assert.equal(world.selection, '日本-1')
  })
})

describe('sparkleGrokProbe：全灭退避与恢复', () => {
  const grok = useGrokRig()
  const via = (): string[] => world.requests.map((request) => request.via)

  it('池内与发现都找不到可用节点：记空轮，退避期内只复核当前节点', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.defaultRouted = challenge()

    await runBootstrap(grok())
    assertLog('WARN no usable node (empty_rounds=1 next_repair_in=60s)')
    const requestsInFirstRound = world.requests.length
    assert.equal(requestsInFirstRound, 8)

    advance(10 * SECOND_MS)
    await runBootstrap(grok())

    assert.equal(world.requests.length, requestsInFirstRound + 1)
    assertLog('pin failed, repair backoff 50s remaining (empty_rounds=1)')
  })

  it('恢复后空轮计数清零：再次全灭从第 1 档重新计', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.defaultRouted = challenge()
    await runBootstrap(grok())

    // 过了退避期，当前节点已恢复：这一轮通过复核，不扫描。
    advance(61 * SECOND_MS)
    world.defaultRouted = ok()
    await runBootstrap(grok())
    assert.equal(world.logs.at(-1), `[SparkleGrokProbe]: selected=${world.selection}\n`)

    advance(61 * SECOND_MS)
    world.defaultRouted = challenge()
    await runBootstrap(grok())

    const warnings = world.logs.filter((line) => line.includes('WARN no usable node'))
    assert.equal(warnings.length, 2)
    assert.match(warnings[1], /empty_rounds=1 next_repair_in=60s/)
  })

  it('退避期里当前节点恢复就取消退避：随后立刻再次失败会马上扫描，不必等旧退避到期', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    world.defaultRouted = challenge()
    await runBootstrap(grok())

    advance(5 * SECOND_MS)
    world.defaultRouted = ok()
    const beforeRecovery = world.requests.length
    await runBootstrap(grok())
    assert.equal(world.requests.length - beforeRecovery, 1)
    assertLog(`selected=${world.selection}`)
    assert.equal(via().at(-1), world.selection)

    advance(SECOND_MS)
    world.defaultRouted = challenge()
    const beforeFailure = world.requests.length
    await runBootstrap(grok())

    assert.equal(world.requests.length - beforeFailure > 1, true)
    assertNoLog('pin failed, repair backoff')
  })
})

describe('sparkleGrokProbe：provider 成员维护', () => {
  const grok = useGrokRig()

  it('验证结论变化导致成员增减时重载 provider', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    writeProviderMembers(['日本-1', '美国-1', '台湾-1', '新加坡-1'])
    world.members = ['日本-1', '美国-1', '台湾-1', '新加坡-1']

    await runBootstrap(grok())

    assert.deepEqual(readProviderMembers(), ['日本-1', '美国-1', '台湾-1'])
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-grok'])
    assert.deepEqual(world.members, ['日本-1', '美国-1', '台湾-1'])
  })

  it('只是顺序变了：重写文件但不重载（只有增删节点才需要让 mihomo 重读）', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    writeProviderMembers(['台湾-1', '美国-1', '日本-1'])

    await runBootstrap(grok())

    assert.deepEqual(readProviderMembers(), ['日本-1', '美国-1', '台湾-1'])
    assert.deepEqual(callsStarting('update:'), [])
  })

  it('重载失败只记一次日志，之后每轮继续重试；成功后再失败会重新记一次', async () => {
    seedHealthyPool()
    skipPoolRefresh()
    const withStaleMember = ['日本-1', '美国-1', '台湾-1', '新加坡-1']
    writeProviderMembers(withStaleMember)
    world.updateFailure = { reason: new Error('boom') }

    await runBootstrap(grok())
    advance(61 * SECOND_MS)
    await runBootstrap(grok())

    assert.equal(callsStarting('update:').length, 2)
    const failures = (): string[] =>
      world.logs.filter((line) => line.includes('provider reload failed'))
    assert.deepEqual(failures(), ['[SparkleGrokProbe]: provider reload failed err=boom\n'])

    world.updateFailure = undefined
    advance(61 * SECOND_MS)
    await runBootstrap(grok())
    assert.equal(callsStarting('update:').length, 3)

    advance(61 * SECOND_MS)
    await runBootstrap(grok())
    assert.equal(callsStarting('update:').length, 3, '重载成功后不再重复')

    // 外部又改了成员，且这次重载再失败：要重新记一次。
    writeProviderMembers(withStaleMember)
    world.updateFailure = { reason: 'plain failure' }
    advance(61 * SECOND_MS)
    await runBootstrap(grok())
    assert.deepEqual(failures(), [
      '[SparkleGrokProbe]: provider reload failed err=boom\n',
      '[SparkleGrokProbe]: provider reload failed err=plain failure\n'
    ])
  })

  it('24 小时前的存活样本不可信：池子回退到全量订阅节点交给 health-check 复核', async () => {
    const stale = 25 * 60 * 60 * 1000
    writeCache({
      [cacheKey(JP1)]: cacheRecord(true, 120, stale),
      [cacheKey(US1)]: cacheRecord(true, 200, stale)
    })
    writeProviderMembers(['日本-1', '美国-1'])
    world.members = ['日本-1', '美国-1']
    world.selection = '日本-1'
    skipPoolRefresh()

    await runBootstrap(grok())

    assert.deepEqual(readProviderMembers(), ['香港-1', '台湾-1', '日本-1', '美国-1', '新加坡-1'])
    assert.deepEqual(world.members, ['香港-1', '台湾-1', '日本-1', '美国-1', '新加坡-1'])
  })

  it('订阅里的香港节点即使验证通过也排在非香港节点之后', async () => {
    writeCache({
      [cacheKey(HK1)]: cacheRecord(true, 30),
      [cacheKey(TW1)]: cacheRecord(true, 300),
      [cacheKey(SG1)]: cacheRecord(true, 250)
    })
    writeProviderMembers(['香港-1', '新加坡-1', '台湾-1'])
    world.members = ['香港-1', '新加坡-1', '台湾-1']
    world.selection = '新加坡-1'
    skipPoolRefresh()

    await runBootstrap(grok())

    assert.deepEqual(readProviderMembers(), ['新加坡-1', '台湾-1', '香港-1'])
  })
})
