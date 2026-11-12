// [INPUT] sparkleGrokProbe（经 sparkleGrokProbeRig 装配：假 axios / mihomo / 配置，真实临时文件）
// [OUTPUT] 池内延迟刷新、试过节点的殿后窗口、单轮预算的行为断言
// [POS] 稳态里的两类时间相关行为：每 5 分钟非侵入式刷新池内延迟；换节点时 15 分钟内试过的候选殿后，以及单轮 10 分钟的总预算。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  JP1,
  MINUTE_MS,
  NOW,
  TW1,
  US1,
  assertLog,
  assertNoLog,
  cacheKey,
  cacheRecord,
  callsStarting,
  challenge,
  makeNodes,
  nameOf,
  readCache,
  readProviderMembers,
  runBootstrap,
  seedHealthyPool,
  setNow,
  skipPoolRefresh,
  useGrokRig,
  world,
  writeCache,
  writeProviderMembers,
  type Proxy
} from './sparkleGrokProbeRig'

const POOL_DELAYS = { '日本-1': 100, '美国-1': 200, '台湾-1': 300 }

describe('sparkleGrokProbe：池内延迟刷新', () => {
  const grok = useGrokRig()

  it('用 group-delay(expected=200) 的结果更新缓存：通过的写入 RTT，没通过的标记失败，当前节点与已不在订阅里的节点跳过', async () => {
    seedHealthyPool()
    writeProviderMembers(['日本-1', '美国-1', '台湾-1', '旧节点'])
    world.groupDelays = { '日本-1': 130, '美国-1': 0, '台湾-1': 210, 旧节点: 50 }

    await runBootstrap(grok())

    assert.deepEqual(world.groupDelayCalls, [
      {
        group: 'grok 专用',
        url: 'https://grok.com',
        options: { timeoutMs: 8000, expectedStatus: '200' }
      }
    ])
    const cache = readCache()
    assert.deepEqual(cache[cacheKey(US1)], {
      alive: false,
      rttMs: 0,
      checkedAt: NOW + 40,
      reason: 'group-delay 未通过（超时或 403 挑战）'
    })
    assert.deepEqual(cache[cacheKey(TW1)], {
      alive: true,
      rttMs: 210,
      checkedAt: NOW + 40,
      status: 200
    })
    // 当前节点不取 group-delay 的结果，而是以随后的真实请求为准。
    assert.deepEqual(cache[cacheKey(JP1)], {
      alive: true,
      rttMs: 5,
      checkedAt: NOW + 45,
      status: 200
    })
    assert.equal(Object.keys(cache).length, 3)
    assertLog('pool refresh members=4 ok=1 elapsed=40ms')
    // 刷新结果当轮就影响池子：没通过的美国-1 和已不在订阅的旧节点被移出。
    assert.deepEqual(readProviderMembers(), ['日本-1', '台湾-1'])
    assert.deepEqual(world.members, ['日本-1', '台湾-1'])
  })

  it('最小的有效延迟（1 毫秒）算通过，0 才算没通过', async () => {
    seedHealthyPool()
    world.groupDelays = { '日本-1': 100, '美国-1': 1, '台湾-1': 0 }

    await runBootstrap(grok())

    const cache = readCache()
    assert.deepEqual([cache[cacheKey(US1)].alive, cache[cacheKey(US1)].rttMs], [true, 1])
    assert.equal(cache[cacheKey(TW1)].alive, false)
  })

  it('每 5 分钟刷新一次：差 1 毫秒不刷，到点才刷', async () => {
    seedHealthyPool()
    world.groupDelays = POOL_DELAYS

    await runBootstrap(grok())
    assert.equal(callsStarting('delay:').length, 1)

    setNow(NOW + 5 * MINUTE_MS - 1)
    await runBootstrap(grok())
    assert.equal(callsStarting('delay:').length, 1)

    setNow(NOW + 5 * MINUTE_MS)
    await runBootstrap(grok())
    assert.equal(callsStarting('delay:').length, 2)
  })

  it('刷新失败只记日志不动缓存，也要等满 5 分钟才会再试', async () => {
    seedHealthyPool()
    world.groupDelayFailure = { reason: new Error('delay api down') }

    await runBootstrap(grok())

    assertLog('pool refresh failed err=delay api down')
    assert.equal(cacheKey(US1) in readCache(), true)
    assert.equal(readCache()[cacheKey(US1)].rttMs, 200)

    setNow(NOW + 4 * MINUTE_MS)
    await runBootstrap(grok())
    assert.equal(callsStarting('delay:').length, 1)

    world.groupDelayFailure = { reason: 'bad gateway' }
    setNow(NOW + 5 * MINUTE_MS)
    await runBootstrap(grok())
    assertLog('pool refresh failed err=bad gateway')
    assert.equal(callsStarting('delay:').length, 2)
  })

  it('provider 文件还不存在时无从刷新，不占用刷新周期：文件建好后的下一轮马上刷新', async () => {
    writeCache({
      [cacheKey(JP1)]: cacheRecord(true, 120),
      [cacheKey(US1)]: cacheRecord(true, 200)
    })
    world.groupDelays = POOL_DELAYS

    await runBootstrap(grok())
    assert.deepEqual(callsStarting('delay:'), [])
    assert.deepEqual(readProviderMembers(), ['日本-1', '美国-1'])

    setNow(NOW + 60 * 1000)
    await runBootstrap(grok())
    assert.equal(callsStarting('delay:').length, 1)
  })
})

describe('sparkleGrokProbe：试过的节点殿后', () => {
  const grok = useGrokRig()
  const via = (): string[] => world.requests.map((request) => request.via)

  /** 全灭一轮，返回这一轮结束时的时间。 */
  async function failEverywhereOnce(): Promise<number> {
    seedHealthyPool()
    skipPoolRefresh()
    world.defaultRouted = challenge()
    await runBootstrap(grok())
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
    world.requests = []
    return Date.now()
  }

  it('15 分钟内试过的候选殿后：下一轮发现阶段先验证当前节点以外没试过的，全都试过就按原顺序', async () => {
    const endedAt = await failEverywhereOnce()

    setNow(endedAt + 14 * MINUTE_MS)
    await runBootstrap(grok())

    // 组里当前停在上一轮最后验证的美国-1；池内扫描 4 个，发现阶段 5 个都是 15 分钟内试过的，保持候选原顺序。
    assert.deepEqual(via(), [
      '美国-1',
      '香港-1',
      '台湾-1',
      '日本-1',
      '新加坡-1',
      '台湾-1',
      '日本-1',
      '美国-1',
      '新加坡-1',
      '香港-1'
    ])
  })

  it('超过 15 分钟的尝试不再殿后', async () => {
    const endedAt = await failEverywhereOnce()

    setNow(endedAt + 16 * MINUTE_MS)
    await runBootstrap(grok())

    // 美国-1 的上次尝试已过窗口，发现阶段把它排到最前。
    assert.deepEqual(via().slice(5, 7), ['美国-1', '台湾-1'])
  })

  it('满 15 分钟的尝试不再殿后：窗口是不含 15 分钟整的', async () => {
    const endedAt = await failEverywhereOnce()

    setNow(endedAt + 15 * MINUTE_MS)
    await runBootstrap(grok())

    assert.deepEqual(via().slice(5, 7), ['美国-1', '台湾-1'])
  })

  it('1 小时后旧的尝试记录被清理，行为与过窗口一致', async () => {
    const endedAt = await failEverywhereOnce()

    setNow(endedAt + 61 * MINUTE_MS)
    await runBootstrap(grok())

    assert.deepEqual(via().slice(5, 7), ['美国-1', '台湾-1'])
  })
})

describe('sparkleGrokProbe：单轮预算', () => {
  const grok = useGrokRig()

  /** 稳态起点：这些节点都已验证通过并在池里，组里选中第一个。 */
  function seedPool(nodes: Proxy[]): string[] {
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
    return names
  }

  it('池内扫描途中预算（10 分钟）一到点就停，发现阶段也不再开始', async () => {
    seedPool(makeNodes(6))
    world.defaultRouted = challenge(200 * 1000)

    await runBootstrap(grok())

    // 复核当前节点 200s，扫描第 1 个 400s，第 2 个 600s：刚好用完预算，不再开始下一个。
    assert.equal(world.requests.length, 3)
    assertLog('discovery probed=0 working=0')
    assertNoLog('selected=')
  })

  it('池内扫描每轮最多验证 6 个节点（当前节点不算），之后由发现阶段接着试', async () => {
    const names = seedPool(makeNodes(9))
    world.defaultRouted = challenge()

    await runBootstrap(grok())

    const via = world.requests.map((request) => request.via)
    assert.deepEqual(via.slice(1, 7), names.slice(1, 7))
    // 发现阶段：本轮没试过的（当前节点与最后两个）排在前面，再轮到试过的。
    assert.deepEqual(via.slice(7), [names[0], names[7], names[8], names[1], names[2], names[3]])
    assertLog('discovery probed=6 working=0')
  })
})
