import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  callsStarting,
  changes,
  ELIGIBLE,
  GEMINI_ALIVE,
  GEMINI_DEAD,
  poll,
  POLL_INTERVAL_MS,
  restricted,
  settle,
  useStickyPinRig,
  world
} from './autoSelectStickyPinRig'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import { AUTO_SELECT_GEMINI_PROBE_URL } from './defaultAutoSwitchProxy'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import { spyOnTimer } from './timerSpyHarness'

describe('autoSelectStickyPin', () => {
  const sticky = useStickyPinRig()

  describe('pinning', () => {
    it('pins the selected node once it stays selected for two polls in a row', async () => {
      world.leaves = [{ name: 'A', extra: GEMINI_ALIVE }]
      sticky.start()

      await poll()
      assert.deepEqual(changes(), [], 'one sighting is not enough')
      await poll()

      assert.deepEqual(changes(), ['A'])
      assert.deepEqual(world.logs, ['[AutoSelectSticky]: pinned A\n'])
      assert.deepEqual(callsStarting('region:'), ['region:A'])
    })

    it('does not ask about the region again right after pinning', async () => {
      world.leaves = [{ name: 'A', extra: GEMINI_ALIVE }]
      sticky.start()
      await poll(2)
      world.calls = []

      await poll()

      assert.deepEqual(callsStarting('region:'), [])
    })

    it('starts counting again when the selected node changes in between', async () => {
      world.leaves = [
        { name: 'A', extra: GEMINI_ALIVE },
        { name: 'B', extra: GEMINI_ALIVE }
      ]
      sticky.start()

      await poll()
      world.group.now = 'B'
      await poll()
      assert.deepEqual(changes(), [])
      await poll()

      assert.deepEqual(changes(), ['B'])
    })

    it('never pins a group that is not a fallback group', async () => {
      world.group = { type: 'URLTest', now: 'A', all: ['A'] }
      sticky.start()

      await poll(3)

      assert.deepEqual(changes(), [])
      assert.deepEqual(world.logs, [])
    })

    it('never pins a node that is not a member of the group', async () => {
      world.group = { type: 'Fallback', now: 'Z', all: ['A'] }
      sticky.start()

      await poll(3)

      assert.deepEqual(changes(), [])
    })

    it('pins without a probe when the provider does not list the node', async () => {
      sticky.start()

      await poll(2)

      assert.deepEqual(changes(), ['A'])
      assert.deepEqual(callsStarting('delay:'), [])
    })

    it('trusts a cached Gemini verdict over a new probe', async () => {
      world.leaves = [{ name: 'A', extra: GEMINI_DEAD }]
      sticky.start()

      await poll(3)

      assert.deepEqual(changes(), [])
      assert.deepEqual(callsStarting('delay:'), [])
    })

    it('measures a node that has no Gemini sample yet and pins it only when it answers', async () => {
      world.leaves = [{ name: 'A' }]
      world.delayOf = () => 0
      sticky.start()
      await poll(3)
      assert.deepEqual(changes(), [], 'zero delay means dead')

      world.delayOf = () => new Error('timeout')
      await poll(2)
      assert.deepEqual(changes(), [], 'a failing probe means dead')

      world.delayOf = () => 85
      await poll(2)

      assert.deepEqual(changes(), ['A'])
      assert.ok(
        world.calls.includes(`delay:${FAST_NODE_PROVIDER_ID}:A:${AUTO_SELECT_GEMINI_PROBE_URL}`)
      )
    })

    it('counts any positive delay as alive', async () => {
      world.leaves = [{ name: 'A' }]
      world.delayOf = () => 1
      sticky.start()

      await poll(2)

      assert.deepEqual(changes(), ['A'])
    })

    it('rejects a node in a restricted region and counts again from zero', async () => {
      world.leaves = [{ name: 'A', extra: GEMINI_ALIVE }]
      world.regionOf = () => restricted('CN')
      sticky.start()

      await poll(3)
      assert.deepEqual(world.logs, [
        '[AutoSelectSticky]: rejected region-restricted node A (region=CN)\n'
      ])
      await poll()

      assert.deepEqual(changes(), [])
      assert.equal(world.logs.length, 2, 'the second rejection needed two fresh sightings')
    })

    it('lets a region check without a verdict through', async () => {
      world.leaves = [{ name: 'A', extra: GEMINI_ALIVE }]
      world.regionOf = () => ({ eligible: false, definitive: false })
      sticky.start()

      await poll(2)

      assert.deepEqual(changes(), ['A'])
    })

    it('leaves the group alone when it changed while the node was being checked', async () => {
      world.leaves = [{ name: 'A', extra: GEMINI_ALIVE }]
      sticky.start()
      await poll()
      world.onDetail = (call) => {
        // 第二轮的第三次读取（复核后重读）看到别处已经把组固定了
        if (call === 3) world.group.fixed = 'B'
      }

      await poll()

      assert.deepEqual(changes(), [])
    })

    it('leaves the group alone when the node stopped being the selected one meanwhile', async () => {
      world.leaves = [{ name: 'A', extra: GEMINI_ALIVE }]
      sticky.start()
      await poll()
      world.onDetail = (call) => {
        if (call === 3) world.group.now = 'B'
      }

      await poll()

      assert.deepEqual(changes(), [])
    })

    it('does not pin a node whose check was invalidated by a release', async () => {
      world.leaves = [{ name: 'A', extra: GEMINI_ALIVE }]
      world.regionOf = () => {
        sticky.notifyUnfixed(AUTO_SELECT_GROUP_NAME)
        return ELIGIBLE
      }
      sticky.start()

      await poll(2)

      assert.deepEqual(changes(), [])
    })

    it('mentions the node it left when the pinned node disappears and another is pinned', async () => {
      world.leaves = [
        { name: 'A', extra: GEMINI_ALIVE },
        { name: 'B', extra: GEMINI_ALIVE }
      ]
      sticky.start()
      await poll(2)
      world.group.fixed = undefined
      world.group.now = 'B'
      world.group.all = ['B', 'C']

      await poll(2)

      assert.deepEqual(changes(), ['A', 'B'])
      assert.equal(world.logs.at(-1), '[AutoSelectSticky]: pinned B (left A)\n')
    })

    it('names a node somebody else pinned as the one it left', async () => {
      world.leaves = [{ name: 'B', extra: GEMINI_ALIVE }]
      world.group = { type: 'Fallback', now: 'A', fixed: 'X', all: ['A', 'B', 'X'] }
      sticky.start()
      await poll()

      world.group = { type: 'Fallback', now: 'B', all: ['B'] }
      await poll(2)

      assert.equal(world.logs.at(-1), '[AutoSelectSticky]: pinned B (left X)\n')
    })

    it('does not claim to have left a node that was released on purpose', async () => {
      world.leaves = [
        { name: 'A', extra: GEMINI_ALIVE },
        { name: 'B', extra: GEMINI_ALIVE }
      ]
      sticky.start()
      await poll(2)
      world.group.fixed = undefined
      world.group.now = 'B'
      sticky.notifyUnfixed(AUTO_SELECT_GROUP_NAME)

      await poll(2)

      assert.equal(world.logs.at(-1), '[AutoSelectSticky]: pinned B\n')
    })
  })

  describe('the polling loop', () => {
    it('keeps polling after a failed poll and forgets what it saw before it', async () => {
      world.leaves = [{ name: 'A', extra: GEMINI_ALIVE }]
      sticky.start()
      await poll(2)
      world.calls = []

      world.detailError = new Error('controller down')
      await poll()
      world.detailError = undefined
      world.group.fixed = undefined
      await poll()

      assert.deepEqual(callsStarting('delay:'), [], 'no rescue: the memory of the pin is gone')
      assert.deepEqual(changes(), [])
      await poll()
      assert.deepEqual(changes(), ['A'])
    })

    it('never runs two polls at once', async () => {
      // 非 fallback 组的每一轮只读一次组状态，读取次数即轮询次数
      world.group.type = 'URLTest'
      let release: () => void = () => undefined
      world.onDetail = (call) =>
        call === 1
          ? new Promise<void>((resolve) => {
              release = resolve
            })
          : undefined
      sticky.start()

      await poll(3)
      assert.equal(world.detailCalls, 1)

      release()
      await settle()
      await poll()

      assert.equal(world.detailCalls, 2)
    })

    it('registers one timer that does not keep the process alive', () => {
      const timers = spyOnTimer('setInterval')
      try {
        sticky.start()
        sticky.start()

        assert.deepEqual(timers.delays, [POLL_INTERVAL_MS])
        assert.equal(timers.unrefs(), 1)
      } finally {
        timers.restore()
      }
    })
  })
})
