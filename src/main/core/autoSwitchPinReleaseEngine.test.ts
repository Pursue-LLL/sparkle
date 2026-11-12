import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AutoSwitchGroupSnapshot } from './autoSwitchPinReleaseCore'
import { createAutoSwitchPinReleaser } from './autoSwitchPinReleaseEngine'

const TAIWAN = 'Sparkle-台湾'
const HONG_KONG = 'Sparkle-香港'

function snapshot(): AutoSwitchGroupSnapshot[] {
  return [
    { name: TAIWAN, type: 'URLTest', fixed: 'TW-1', all: ['TW-1', 'TW-2'] },
    { name: HONG_KONG, type: 'URLTest', fixed: 'HK-gone', all: ['HK-1'] },
    { name: '🚀 节点选择', type: 'Selector', fixed: '自动选择', all: ['自动选择'] }
  ]
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function createHarness(groups: AutoSwitchGroupSnapshot[] = snapshot()) {
  const unpins: string[] = []
  const probes: string[] = []
  const logs: string[] = []
  const behavior = {
    loadError: undefined as Error | undefined,
    unpinFails: new Set<string>(),
    probeError: undefined as Error | undefined,
    logError: undefined as Error | undefined
  }
  const release = createAutoSwitchPinReleaser({
    loadGroups: async () => {
      if (behavior.loadError) {
        throw behavior.loadError
      }
      return groups
    },
    unpin: async (group) => {
      if (behavior.unpinFails.has(group)) {
        throw new Error(`cannot unpin ${group}`)
      }
      unpins.push(group)
    },
    probeGroup: async (group) => {
      probes.push(group)
      if (behavior.probeError) {
        throw behavior.probeError
      }
    },
    log: async (line) => {
      if (behavior.logError) {
        throw behavior.logError
      }
      logs.push(line)
    }
  })
  return { release, unpins, probes, logs, behavior }
}

describe('auto switch pin releaser', () => {
  it('releases every pin on auto switch groups for scope all and probes each group', async () => {
    const h = createHarness()

    assert.equal(await h.release('all'), 2)
    await flush()

    assert.deepEqual(h.unpins, [TAIWAN, HONG_KONG])
    assert.deepEqual(h.probes, [TAIWAN, HONG_KONG])
    assert.deepEqual(h.logs, [
      `[AutoSwitchPin]: released ${TAIWAN} pinned=TW-1 reason=cache-restored scope=all\n`,
      `[AutoSwitchPin]: released ${HONG_KONG} pinned=HK-gone reason=orphan scope=all\n`
    ])
  })

  it('releases only orphaned pins for scope orphans', async () => {
    const h = createHarness()

    assert.equal(await h.release('orphans'), 1)
    await flush()

    assert.deepEqual(h.unpins, [HONG_KONG])
    assert.deepEqual(h.probes, [HONG_KONG])
    assert.deepEqual(h.logs, [
      `[AutoSwitchPin]: released ${HONG_KONG} pinned=HK-gone reason=orphan scope=orphans\n`
    ])
  })

  it('does nothing when no auto switch group is pinned', async () => {
    const h = createHarness([{ name: TAIWAN, type: 'URLTest', all: ['TW-1'] }])

    assert.equal(await h.release('all'), 0)
    assert.deepEqual(h.unpins, [])
    assert.deepEqual(h.logs, [])
  })

  it('carries on with the other groups when one release fails', async () => {
    const h = createHarness()
    h.behavior.unpinFails.add(TAIWAN)

    assert.equal(await h.release('all'), 1)
    await flush()

    assert.deepEqual(h.unpins, [HONG_KONG])
    assert.deepEqual(h.probes, [HONG_KONG])
    assert.deepEqual(h.logs, [
      `[AutoSwitchPin]: release failed group=${TAIWAN} err=cannot unpin ${TAIWAN}\n`,
      `[AutoSwitchPin]: released ${HONG_KONG} pinned=HK-gone reason=orphan scope=all\n`
    ])
  })

  it('reports an unreadable group list without throwing', async () => {
    const h = createHarness()
    h.behavior.loadError = new Error('controller down')

    assert.equal(await h.release('orphans'), 0)
    assert.deepEqual(h.unpins, [])
    assert.deepEqual(h.logs, ['[AutoSwitchPin]: plan failed scope=orphans err=controller down\n'])
  })

  it('ignores a failing probe without an unhandled rejection', async () => {
    const h = createHarness()
    h.behavior.probeError = new Error('probe refused')
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      assert.equal(await h.release('all'), 2)
      await flush()
      await flush()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }

    assert.deepEqual(unhandled, [])
    assert.deepEqual(h.probes, [TAIWAN, HONG_KONG])
  })

  it('never lets a failing logger change what gets released', async () => {
    const h = createHarness()
    h.behavior.logError = new Error('disk full')

    assert.equal(await h.release('all'), 2)
    assert.deepEqual(h.unpins, [TAIWAN, HONG_KONG])
  })

  it('serves later calls after a failed one', async () => {
    const h = createHarness()
    h.behavior.loadError = new Error('controller down')
    assert.equal(await h.release('all'), 0)

    h.behavior.loadError = undefined
    assert.equal(await h.release('all'), 2)
  })
})
