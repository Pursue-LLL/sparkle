import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createDueProfileUpdateRunner,
  isMergeProfileDue,
  isRemoteProfileDue,
  latestScheduledSlotMs
} from './profileUpdaterCore'

/** 2026-10-<day> <hour>:<minute>，按本机时区构造，与被测代码的本地时间口径一致。 */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 9, day, hour, minute).getTime()

function remote(overrides: Partial<ProfileItem> = {}): ProfileItem {
  return {
    id: 'main',
    name: '主订阅',
    type: 'remote',
    url: 'https://example.com/sub',
    autoUpdate: true,
    updateTime: '07:00',
    updated: at(10, 7, 0),
    ...overrides
  }
}

function merged(overrides: Partial<ProfileItem> = {}): ProfileItem {
  return {
    id: 'merged',
    name: '合并版',
    type: 'local',
    autoUpdate: true,
    merge: { base: 'main', sources: ['main', 'mobile'], regions: [], dedicatedRegions: [] },
    updated: at(12, 11, 7),
    ...overrides
  }
}

describe('latestScheduledSlotMs', () => {
  it('returns today slot once it has passed and yesterday slot before it', () => {
    assert.equal(latestScheduledSlotMs('07:00', at(12, 9, 0)), at(12, 7, 0))
    assert.equal(latestScheduledSlotMs('07:00', at(12, 7, 0)), at(12, 7, 0))
    assert.equal(latestScheduledSlotMs('07:00', at(12, 6, 59)), at(11, 7, 0))
  })

  it('rejects malformed times', () => {
    assert.equal(latestScheduledSlotMs('7am', at(12, 9, 0)), null)
    assert.equal(latestScheduledSlotMs('25:00', at(12, 9, 0)), null)
  })
})

describe('isRemoteProfileDue (daily schedule)', () => {
  it('is due when the machine slept through the slot, however late the check runs', () => {
    const item = remote({ updated: at(10, 7, 0) })
    assert.equal(isRemoteProfileDue(item, at(12, 9, 0)), true)
    assert.equal(isRemoteProfileDue(item, at(12, 23, 59)), true)
  })

  it('stays due after a failed attempt and stops once an update succeeds after the slot', () => {
    const failedAtWake = remote({ updated: at(11, 7, 0) })
    assert.equal(isRemoteProfileDue(failedAtWake, at(12, 7, 13)), true)
    assert.equal(isRemoteProfileDue(failedAtWake, at(12, 7, 18)), true)

    const recovered = remote({ updated: at(12, 7, 19) })
    assert.equal(isRemoteProfileDue(recovered, at(12, 11, 0)), false)
  })

  it('is not due before the next slot when the previous slot was already satisfied', () => {
    assert.equal(isRemoteProfileDue(remote({ updated: at(11, 7, 5) }), at(12, 6, 0)), false)
  })

  it('counts a manual update after the slot as satisfying it', () => {
    assert.equal(isRemoteProfileDue(remote({ updated: at(12, 10, 0) }), at(12, 11, 0)), false)
  })

  it('never updates local profiles, profiles without a url or with auto update turned off', () => {
    assert.equal(isRemoteProfileDue(remote({ type: 'local' }), at(12, 9, 0)), false)
    assert.equal(isRemoteProfileDue(remote({ url: undefined }), at(12, 9, 0)), false)
    assert.equal(isRemoteProfileDue(remote({ autoUpdate: false }), at(12, 9, 0)), false)
  })
})

describe('isRemoteProfileDue (interval)', () => {
  const byInterval = (overrides: Partial<ProfileItem> = {}): ProfileItem =>
    remote({ updateTime: undefined, interval: 240, updated: at(12, 5, 0), ...overrides })

  it('becomes due once a full interval has elapsed', () => {
    assert.equal(isRemoteProfileDue(byInterval(), at(12, 8, 59)), false)
    assert.equal(isRemoteProfileDue(byInterval(), at(12, 9, 0)), true)
  })

  it('falls back to the interval when the daily time is malformed', () => {
    assert.equal(isRemoteProfileDue(byInterval({ updateTime: 'soon' }), at(12, 10, 0)), true)
  })

  it('is never due without any schedule', () => {
    assert.equal(isRemoteProfileDue(remote({ updateTime: undefined, interval: 0 }), at(12, 9, 0)), false)
  })
})

describe('isMergeProfileDue', () => {
  const sources = (mainUpdated: number, mobileUpdated: number): ProfileItem[] => [
    remote({ id: 'main', updated: mainUpdated }),
    remote({ id: 'mobile', name: '移动订阅', updated: mobileUpdated })
  ]

  it('is due when any source is newer than the merged profile', () => {
    const items = [...sources(at(12, 11, 7), at(12, 11, 7)), merged({ updated: at(10, 7, 0) })]
    assert.equal(isMergeProfileDue(items[2], items), true)
  })

  it('is due when only the mobile source moved ahead', () => {
    const items = [...sources(at(12, 7, 0), at(12, 11, 7)), merged({ updated: at(12, 8, 0) })]
    assert.equal(isMergeProfileDue(items[2], items), true)
  })

  it('is not due once it was rebuilt after every source', () => {
    const items = [...sources(at(12, 11, 7), at(12, 11, 7)), merged({ updated: at(12, 11, 8) })]
    assert.equal(isMergeProfileDue(items[2], items), false)
  })

  it('ignores missing sources, non-merge profiles and disabled auto update', () => {
    const lonely = merged({ updated: at(10, 7, 0) })
    assert.equal(isMergeProfileDue(lonely, [lonely]), false)

    const items = [...sources(at(12, 11, 7), at(12, 11, 7))]
    assert.equal(isMergeProfileDue(remote(), items), false)
    assert.equal(isMergeProfileDue(merged({ updated: at(10, 7, 0), autoUpdate: false }), items), false)
  })
})

describe('createDueProfileUpdateRunner', () => {
  const NOW = at(12, 11, 0)

  function setup(failures: Set<string> = new Set()) {
    const items: ProfileItem[] = [
      remote({ id: 'main', updated: at(10, 7, 0) }),
      remote({ id: 'mobile', name: '移动订阅', updated: at(10, 7, 0) }),
      merged({ updated: at(10, 7, 0) })
    ]
    const calls: string[] = []
    const logs: string[] = []
    // 每次更新让时钟前进，保证后更新的订阅严格晚于先更新的（真实场景里重建总晚于来源开始更新）
    let clock = NOW
    const run = createDueProfileUpdateRunner({
      now: () => clock,
      listItems: async () => items,
      update: async (item) => {
        calls.push(item.id)
        if (failures.has(item.id)) {
          throw new Error(`getaddrinfo ENOTFOUND ${item.id}`)
        }
        clock += 1000
        const stored = items.find((candidate) => candidate.id === item.id)
        if (stored) {
          stored.updated = clock
        }
      },
      log: async (message) => {
        logs.push(message)
      }
    })
    return { items, calls, logs, run }
  }

  it('updates due sources first, then rebuilds the merged profile that fell behind', async () => {
    const { calls, run } = setup()
    assert.equal(await run(), 3)
    assert.deepEqual(calls, ['main', 'mobile', 'merged'])
    assert.equal(await run(), 0)
    assert.deepEqual(calls, ['main', 'mobile', 'merged'])
  })

  it('keeps going after a failure and retries the failed source on the next run', async () => {
    const failures = new Set(['main'])
    const { calls, logs, run } = setup(failures)

    assert.equal(await run(), 2)
    assert.deepEqual(calls, ['main', 'mobile', 'merged'])
    assert.equal(logs.filter((line) => line.includes('update failed id=main')).length, 1)
    assert.match(logs.join(''), /ENOTFOUND main/)

    failures.clear()
    calls.length = 0
    assert.equal(await run(), 2)
    assert.deepEqual(calls, ['main', 'merged'])
  })

  it('gives up on an update that never finishes so the shared run cannot hang forever', async () => {
    const items: ProfileItem[] = [
      remote({ id: 'main', updated: at(10, 7, 0) }),
      remote({ id: 'mobile', name: '移动订阅', updated: at(10, 7, 0) })
    ]
    const logs: string[] = []
    const calls: string[] = []
    const run = createDueProfileUpdateRunner({
      now: () => NOW,
      updateTimeoutMs: 20,
      listItems: async () => items,
      update: async (item) => {
        calls.push(item.id)
        if (item.id === 'main') {
          await new Promise<void>(() => {
            // 永不结束，模拟半开连接上卡死的下载
          })
        }
      },
      log: async (message) => {
        logs.push(message)
      }
    })

    assert.equal(await run(), 1)
    assert.deepEqual(calls, ['main', 'mobile'])
    assert.match(logs.join(''), /update failed id=main .*未完成/)
    // 上一次卡死不会占住后续执行：main 再次超时，mobile 仍会被重试
    assert.equal(await run(), 1)
    assert.deepEqual(calls, ['main', 'mobile', 'main', 'mobile'])
  })

  it('shares one execution between concurrent callers and allows a new run afterwards', async () => {
    const items: ProfileItem[] = [remote({ id: 'main', updated: at(10, 7, 0) })]
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let updates = 0
    const run = createDueProfileUpdateRunner({
      now: () => NOW,
      listItems: async () => items,
      update: async (item) => {
        updates += 1
        await gate
        items[0] = { ...item, updated: NOW }
      },
      log: async () => undefined
    })

    const first = run()
    const second = run()
    assert.equal(first, second)
    release()
    assert.equal(await first, 1)
    assert.equal(updates, 1)

    items[0] = { ...items[0], updated: at(10, 7, 0) }
    assert.equal(await run(), 1)
    assert.equal(updates, 2)
  })
})
