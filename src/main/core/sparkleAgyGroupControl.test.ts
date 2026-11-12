// [INPUT] sparkleAgyGroupControl（经 sparkleAgyProbeRig 装配：假 agy CLI / mihomo / 配置，真实临时文件）
// [OUTPUT] agy 组操作三个导出函数的行为断言
// [POS] 直接驱动 probeSingleNode / convergeAgyProvider / selectAgyNode：探测结论的归因保证、provider 收敛、选择切换。
// 上层巡检编排（sparkleAgyProbe）只通过这三个函数碰组，这里把它们各自的分支钉死。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGY_GROUP,
  ANYTLS,
  HANG,
  HK1,
  LOCATION,
  NODES,
  NOW,
  POOL,
  TW1,
  cacheKey,
  cacheRecord,
  callsStarting,
  drive,
  groupControl,
  okAfter,
  readProviderMembers,
  snapshot,
  syncSnapshot,
  useAgyRig,
  world
} from './sparkleAgyProbeRig'

const DEFAULT_PRIORITY = ['台湾', '日本', '韩国', '新加坡', '美国']
const DETAIL = `detail:${AGY_GROUP}`
const CLOSE = `close:${AGY_GROUP}`

useAgyRig()

describe('probeSingleNode：先确认能把结论算到这个节点头上', () => {
  it('组还没生成：不启动 agy，不切组，返回不下结论且不中止', async () => {
    world.groupMissing = true

    const outcome = await groupControl().probeSingleNode('台湾-1', 90_000)

    assert.deepEqual(outcome, { verdict: 'unknown', rttMs: 0, fatal: false })
    assert.equal(world.spawns.length, 0)
    assert.deepEqual(world.calls, [DETAIL])
  })

  it('组里没有选中节点（空选择）同样不可归因', async () => {
    world.selection = undefined

    const outcome = await groupControl().probeSingleNode('台湾-1', 90_000)

    assert.deepEqual(outcome, { verdict: 'unknown', rttMs: 0, fatal: false })
    assert.equal(world.spawns.length, 0)
  })

  it('单字符的节点名也是有效选择', async () => {
    world.members = ['X', 'Y']
    world.selection = 'X'

    await groupControl().probeSingleNode('X', 90_000)

    assert.deepEqual(world.probedVia, ['X'])
  })

  it('目标不是当前选择：先切组再断连，之后同一节点不必再切、再断', async () => {
    await groupControl().probeSingleNode('日本-1', 90_000)

    // 第一次观察到选择 台湾-1 就先断一次旧连接，再切到日本-1 并断开切组前的连接。
    assert.deepEqual(world.calls, [DETAIL, CLOSE, 'change:日本-1', CLOSE])
    assert.deepEqual(world.probedVia, ['日本-1'])

    await groupControl().probeSingleNode('日本-1', 90_000)

    assert.deepEqual(world.calls.slice(4), [DETAIL])
  })

  it('选择被别处改动过：先补断旧连接，再探测', async () => {
    await groupControl().probeSingleNode('台湾-1', 90_000)
    assert.deepEqual(world.calls, [DETAIL, CLOSE])

    world.selection = '日本-1'
    await groupControl().probeSingleNode('日本-1', 90_000)

    assert.deepEqual(world.calls.slice(2), [DETAIL, CLOSE])
    assert.deepEqual(world.probedVia, ['台湾-1', '日本-1'])
  })

  for (const [title, setup] of [
    [
      '切换被 mihomo 拒绝',
      () => {
        world.changeRefused = new Set(['日本-1'])
      }
    ],
    [
      '切换接口报错',
      () => {
        world.changeFailure = true
      }
    ]
  ] as const) {
    it(`${title}：不启动 agy，也不再断连，返回不下结论`, async () => {
      setup()

      const outcome = await groupControl().probeSingleNode('日本-1', 90_000)

      assert.deepEqual(outcome, { verdict: 'unknown', rttMs: 0, fatal: false })
      assert.equal(world.spawns.length, 0)
      assert.deepEqual(world.calls, [DETAIL, CLOSE, 'change:日本-1'])
    })
  }

  it('断不掉旧连接就不能归因：返回不下结论，不启动 agy', async () => {
    world.closeFailure = true

    const outcome = await groupControl().probeSingleNode('日本-1', 90_000)

    assert.deepEqual(outcome, { verdict: 'unknown', rttMs: 0, fatal: false })
    assert.equal(world.spawns.length, 0)
  })
})

describe('probeSingleNode：把 agy 的结局变成结论', () => {
  it('耗时取这次请求前后的差值（不是累计值）', async () => {
    world.outcomes = [okAfter(250), okAfter(300)]

    const first = await groupControl().probeSingleNode('台湾-1', 90_000)
    const second = await groupControl().probeSingleNode('台湾-1', 90_000)

    assert.deepEqual(first, { verdict: 'usable', rttMs: 250, fatal: false })
    assert.deepEqual(second, { verdict: 'usable', rttMs: 300, fatal: false })
  })

  it('地区不支持 → unusable，并登记到展示快照', async () => {
    world.defaultOutcome = LOCATION

    const outcome = await groupControl().probeSingleNode('台湾-1', 90_000)
    syncSnapshot()

    assert.deepEqual(outcome, { verdict: 'unusable', rttMs: 1, fatal: false })
    assert.deepEqual(snapshot()['台湾-1'], {
      rttMs: 0,
      checkedAt: NOW,
      state: 'unusable',
      reason: '地区不支持'
    })
  })

  it('agy 启动不了 → 中止整轮，并登记失败原因', async () => {
    world.defaultOutcome = { kind: 'throw' }

    const outcome = await groupControl().probeSingleNode('台湾-1', 90_000)
    syncSnapshot()

    assert.deepEqual(outcome, { verdict: 'unknown', rttMs: 0, fatal: true })
    assert.deepEqual(snapshot()['台湾-1'], {
      rttMs: 0,
      checkedAt: NOW,
      state: 'failed',
      reason: 'agy CLI 无法启动'
    })
  })

  it('超时 → 不下结论但记下耗时与失败原因', async () => {
    world.defaultOutcome = HANG

    const outcome = await drive(groupControl().probeSingleNode('台湾-1', 90_000))
    syncSnapshot()

    assert.deepEqual(outcome, { verdict: 'unknown', rttMs: 90_000, fatal: false })
    assert.equal(snapshot()['台湾-1'].state, 'failed')
    assert.equal(snapshot()['台湾-1'].reason, '超时')
  })

  it('可用的结论不进「最近一次失败」，由缓存决定它在快照里的样子', async () => {
    await groupControl().probeSingleNode('台湾-1', 90_000)
    syncSnapshot()

    assert.equal(snapshot()['台湾-1'], undefined)
  })
})

describe('convergeAgyProvider：provider 收敛到目标集合', () => {
  it('没有任何节点有资格进 agy 池：返回空数组，不写盘不重载', async () => {
    const names = await groupControl().convergeAgyProvider(
      [HK1, ANYTLS],
      DEFAULT_PRIORITY,
      undefined
    )

    assert.deepEqual(names, [])
    assert.deepEqual(callsStarting('update:'), [])
    assert.equal(readProviderMembers(), undefined)
  })

  it('成员集合没变：不写盘不重载', async () => {
    const names = await groupControl().convergeAgyProvider(NODES, DEFAULT_PRIORITY, undefined)

    assert.deepEqual(names, POOL)
    assert.deepEqual(callsStarting('update:'), [])
    assert.equal(readProviderMembers(), undefined)
  })

  it('成员数一样但有一个不同：照样写盘并重载', async () => {
    world.members = [...POOL.slice(0, 5), '旧节点']

    const names = await groupControl().convergeAgyProvider(NODES, DEFAULT_PRIORITY, undefined)

    assert.deepEqual(names, POOL)
    assert.deepEqual(readProviderMembers(), POOL)
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-agy'])
    assert.deepEqual(world.members, POOL)
  })

  it('重载让组选择变了：断开旧连接，并记住新选择，之后探测它不必再断', async () => {
    const cache = new Map([[cacheKey(TW1), cacheRecord(false)]])

    const names = await groupControl().convergeAgyProvider(NODES, DEFAULT_PRIORITY, cache)

    // 台湾-1 被移出池子，mihomo 把选择落到第一个成员 台湾-2。
    assert.deepEqual(names, POOL.slice(1))
    assert.equal(world.selection, '台湾-2')
    assert.deepEqual(world.calls, [DETAIL, DETAIL, 'update:sparkle-agy', DETAIL, CLOSE])

    await groupControl().probeSingleNode('台湾-2', 90_000)

    assert.deepEqual(world.calls.slice(5), [DETAIL])
  })

  it('重载没改变组选择：不断连', async () => {
    world.members = POOL.slice(0, 5)

    await groupControl().convergeAgyProvider(NODES, DEFAULT_PRIORITY, undefined)

    assert.deepEqual(callsStarting('close:'), [])
  })

  it('重载后断连失败不影响结果', async () => {
    const cache = new Map([[cacheKey(TW1), cacheRecord(false)]])
    world.closeFailure = true

    const names = await groupControl().convergeAgyProvider(NODES, DEFAULT_PRIORITY, cache)

    assert.deepEqual(names, POOL.slice(1))
    assert.deepEqual(callsStarting('close:'), [CLOSE])
  })

  it('provider 重载失败会抛给调用方（由巡检统一记日志）', async () => {
    world.members = POOL.slice(0, 5)
    world.updateFailure = { reason: new Error('mihomo is down') }

    await assert.rejects(
      groupControl().convergeAgyProvider(NODES, DEFAULT_PRIORITY, undefined),
      /mihomo is down/
    )
  })
})

describe('selectAgyNode：切换选择', () => {
  it('候选池为空：什么都不做，返回 null', async () => {
    const node = await groupControl().selectAgyNode([], '台湾-1')

    assert.equal(node, null)
    assert.deepEqual(world.calls, [])
  })

  it('只有一个候选也要切过去', async () => {
    const node = await groupControl().selectAgyNode(['日本-1'])

    assert.equal(node, '日本-1')
    assert.equal(world.selection, '日本-1')
    assert.deepEqual(world.calls, [DETAIL, 'change:日本-1', CLOSE])
  })

  it('偏好的节点在池里就选它，不在池里选第一个', async () => {
    assert.equal(await groupControl().selectAgyNode(['台湾-2', '日本-1'], '日本-1'), '日本-1')
    assert.equal(await groupControl().selectAgyNode(['台湾-2', '日本-1'], '韩国-1'), '台湾-2')
    assert.equal(await groupControl().selectAgyNode(['日本-1', '台湾-2'], null), '日本-1')
  })

  it('已经在目标节点上：只读一次，不切不断', async () => {
    world.selection = '日本-1'

    const node = await groupControl().selectAgyNode(['日本-1', '台湾-1'], '日本-1')

    assert.equal(node, '日本-1')
    assert.deepEqual(world.calls, [DETAIL])
  })

  for (const [title, setup] of [
    [
      '切换被拒绝',
      () => {
        world.changeRefused = new Set(['日本-1'])
      }
    ],
    [
      '切换接口报错',
      () => {
        world.changeFailure = true
      }
    ]
  ] as const) {
    it(`${title}：留在原来的节点，不断连`, async () => {
      setup()

      const node = await groupControl().selectAgyNode(['日本-1'])

      assert.equal(node, '台湾-1')
      assert.equal(world.selection, '台湾-1')
      assert.deepEqual(callsStarting('close:'), [])
    })
  }

  it('切换成功后记住新选择：随后探测它不必再切、再断', async () => {
    await groupControl().selectAgyNode(['日本-1'])
    await groupControl().probeSingleNode('日本-1', 90_000)

    assert.deepEqual(world.calls.slice(3), [DETAIL])
  })

  it('切换后断连失败不影响结果', async () => {
    world.closeFailure = true

    const node = await groupControl().selectAgyNode(['日本-1'])

    assert.equal(node, '日本-1')
  })
})
