// [INPUT] sparkleAgyProbe（经 sparkleAgyProbeRig 装配：假 agy CLI / mihomo / 配置，真实临时文件）
// [OUTPUT] 节点被拒记忆在巡检里的行为断言：谁被记、谁被回避、严格模式、跨进程与过期
// [POS] 单个探测结论只是抽样：抽中「通过」的坏节点会被反复选回来。被拒记忆让节点出过问题后 24 小时内排到候选最后，
// 通过的探测抹不掉它；pin 只是探测超时时更严格，不为了换而换。排序细节见 sparkleAgyReputation.test.ts。

import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  HOUR_MS,
  HANG,
  LOCATION,
  MINUTE_MS,
  NOW,
  JP1,
  TW1,
  TW2,
  assertLog,
  assertNoLog,
  cacheKey,
  cacheRecord,
  outcomesByNode,
  readState,
  restartProbe,
  runBootstrap,
  runDialFailureRepair,
  useAgyRig,
  world,
  writeCache,
  writeState
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

const flagsOnDisk = (): Record<string, number> =>
  (readState()?.flags ?? {}) as Record<string, number>

/** 把给定节点（名字 → 多久之前）记进磁盘上的被拒记忆，模拟之前的进程留下的判定。 */
function flaggedBefore(ages: Record<string, number>): void {
  const proxies = new Map(world.profileProxies.map((proxy) => [String(proxy.name), proxy]))
  writeState({
    flags: Object.fromEntries(
      Object.entries(ages).map(([name, ageMs]) => [cacheKey(proxies.get(name)!), NOW - ageMs])
    )
  })
}

describe('sparkleAgyProbe 被拒记忆：谁被记下', () => {
  it('pin 两次确认出口被拒：pin 记入被拒记忆，修复扫描试过被拒的候选也记入', async () => {
    outcomesByNode({ '台湾-1': LOCATION, '台湾-2': LOCATION })

    await runBootstrap(agy())

    assert.deepEqual(Object.keys(flagsOnDisk()).sort(), [cacheKey(TW1), cacheKey(TW2)].sort())
    assert.equal(flagsOnDisk()[cacheKey(TW1)], NOW)
    assert.equal(world.selection, '台湾-AnyTLS')
  })

  it('通过的探测不会抹掉记忆：被记过的节点之后再通过，记忆原样保留', async () => {
    flaggedBefore({ '台湾-1': 2 * HOUR_MS })

    await runBootstrap(agy())

    assert.equal(flagsOnDisk()[cacheKey(TW1)], NOW - 2 * HOUR_MS)
    assertNoLog('repair start')
  })

  it('只是超时的节点不记：超时不能证明出口被拒', async () => {
    outcomesByNode({ '台湾-1': HANG })

    await runBootstrap(agy())

    assert.deepEqual(flagsOnDisk(), {})
  })

  it('拨号失败风暴触发的修复：pin 记入被拒记忆，即使修复被退避拦下', async () => {
    writeState({ repairSkipUntilMs: NOW + HOUR_MS })

    await runDialFailureRepair(agy())

    assert.equal(flagsOnDisk()[cacheKey(TW1)], NOW)
    assert.equal(world.spawns.length, 0, '退避期内不扫描')
  })
})

describe('sparkleAgyProbe 被拒记忆：谁被回避', () => {
  it('修复先试没出过问题的候选：被记过的台湾-2 排到最后', async () => {
    flaggedBefore({ '台湾-2': HOUR_MS })
    outcomesByNode({ '台湾-1': LOCATION })

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1', '台湾-AnyTLS'])
    assert.equal(world.selection, '台湾-AnyTLS')
  })

  it('pin 被证明不可用、候选全被记过：照常探测，最久远被拒的最先试，实测通过就用它', async () => {
    flaggedBefore({
      '台湾-2': HOUR_MS,
      '台湾-AnyTLS': 2 * HOUR_MS,
      '日本-1': 3 * HOUR_MS,
      '韩国-1': 4 * HOUR_MS,
      '新加坡-1': 5 * HOUR_MS,
      '美国-1': 23 * HOUR_MS
    })
    outcomesByNode({ '台湾-1': LOCATION })

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1', '美国-1'])
    assert.equal(world.selection, '美国-1')
  })

  it('pin 只是连续超时：被记过的节点不当候选，宁可留在 pin 上，不为了换而换', async () => {
    flaggedBefore({
      '台湾-2': HOUR_MS,
      '台湾-AnyTLS': HOUR_MS,
      '日本-1': HOUR_MS,
      '韩国-1': HOUR_MS,
      '新加坡-1': HOUR_MS,
      '美国-1': HOUR_MS
    })
    outcomesByNode({ '台湾-1': HANG })

    await runBootstrap(agy())
    await runBootstrap(agy())

    assert.deepEqual(
      world.probedVia,
      ['台湾-1', '台湾-1'],
      '只有 pin 自己的两次复测，没有候选被探测'
    )
    assert.equal(world.selection, '台湾-1')
    assertLog('repair start')
    assertLog('WARN no node passed the real agy check (probed=0)')
  })

  it('pin 只是连续超时：没被记过的候选照常顶上', async () => {
    flaggedBefore({ '台湾-2': HOUR_MS })
    outcomesByNode({ '台湾-1': HANG })

    await runBootstrap(agy())
    await runBootstrap(agy())

    assert.equal(world.selection, '台湾-AnyTLS')
  })

  it('记忆 24 小时后失效：台湾-2 重新回到它的地区顺位', async () => {
    flaggedBefore({ '台湾-2': 24 * HOUR_MS })
    outcomesByNode({ '台湾-1': LOCATION })

    await runBootstrap(agy())

    assert.equal(world.selection, '台湾-2')
  })
})

describe('sparkleAgyProbe 被拒记忆：组选择落点', () => {
  /** 台湾-2 最快且在首选地区，但出过问题；日本-1 慢一些，没出过问题。 */
  function seedVerifiedWithFlaggedFastest(): void {
    writeCache({
      [cacheKey(TW2)]: cacheRecord(true, 100),
      [cacheKey(JP1)]: cacheRecord(true, 300)
    })
    flaggedBefore({ '台湾-2': HOUR_MS })
  }

  it('修复全灭、组选择只能落到别处：落点是没出过问题的已验证节点，而不是最快的那个', async () => {
    seedVerifiedWithFlaggedFastest()
    outcomesByNode({
      '台湾-1': LOCATION,
      '台湾-2': HANG,
      '台湾-AnyTLS': HANG,
      '日本-1': HANG,
      '韩国-1': HANG,
      '新加坡-1': HANG,
      '美国-1': HANG
    })

    await runBootstrap(agy())

    assert.equal(world.selection, '日本-1')
  })

  it('pin 没有验证记录、只超时一轮：组选择落到没出过问题的已验证节点', async () => {
    seedVerifiedWithFlaggedFastest()
    outcomesByNode({ '台湾-1': HANG })

    await runBootstrap(agy())

    assert.equal(world.selection, '日本-1')
    assertNoLog('repair start')
  })
})

describe('sparkleAgyProbe 被拒记忆：跨进程', () => {
  it('旧 pin 的缓存结论过期、进程重启之后，它仍被回避', async () => {
    outcomesByNode({ '台湾-1': LOCATION })
    await runBootstrap(agy())
    assert.equal(world.selection, '台湾-2')

    // 「不可用」的缓存结论 30 分钟就过期；被拒记忆还在。
    mock.timers.tick(31 * MINUTE_MS)
    world.probedVia = []
    outcomesByNode({ '台湾-2': LOCATION })
    await runBootstrap(restartProbe())

    // 台湾-1 在订阅里排在台湾-AnyTLS 之前，但它出过问题，被放到没出过问题的候选之后。
    assert.deepEqual(world.probedVia, ['台湾-2', '台湾-2', '台湾-AnyTLS'])
  })

  it('各节点的被拒记忆互不干扰：其余地区的节点照常按顺位', async () => {
    flaggedBefore({ '台湾-1': HOUR_MS, '台湾-2': HOUR_MS, '台湾-AnyTLS': HOUR_MS })
    world.selection = '美国-1'
    outcomesByNode({ '美国-1': LOCATION })

    await runBootstrap(agy())

    assert.equal(world.selection, '日本-1')
    assert.deepEqual(world.probedVia, ['美国-1', '美国-1', '日本-1'])
  })
})
