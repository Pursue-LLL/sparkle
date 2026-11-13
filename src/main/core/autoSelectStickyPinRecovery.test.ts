import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  callsStarting,
  changes,
  ELIGIBLE,
  DELAY_ALIVE,
  jump,
  poll,
  restricted,
  unfixes,
  useStickyPinRig,
  world
} from './autoSelectStickyPinRig'
import {
  FIXED_NODE_REGION_RECHECK_MS,
  STICKY_PIN_RESTORE_COOLDOWN_MS
} from './autoSelectStickyPinCore'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'

describe('autoSelectStickyPin recovery', () => {
  const sticky = useStickyPinRig()

  async function pinA(): Promise<void> {
    world.leaves = [{ name: 'A', extra: DELAY_ALIVE }]
    sticky.start()
    await poll(2)
    assert.deepEqual(changes(), ['A'])
    world.calls = []
    world.logs = []
    world.detailCalls = 0
  }

  describe('a pin that mihomo clears', () => {
    it('puts the node back after a single probe blip, once', async () => {
      await pinA()
      world.group.fixed = undefined

      await poll()

      assert.deepEqual(changes(), ['A'])
      assert.deepEqual(world.logs, ['[AutoSelectSticky]: restored A after single probe blip\n'])

      // 冷却窗口内再次丢固定：不再救回，走普通的两轮稳定后重新固定
      world.calls = []
      world.logs = []
      world.group.fixed = undefined
      await poll()
      assert.deepEqual(callsStarting('delay:'), [], 'no second rescue inside the cooldown')
      assert.deepEqual(changes(), [])
      await poll()
      assert.deepEqual(changes(), ['A'])
      assert.deepEqual(world.logs, ['[AutoSelectSticky]: pinned A\n'])
    })

    it('does not ask about the region again right after it put the node back', async () => {
      await pinA()
      world.group.fixed = undefined
      await poll()
      world.calls = []

      await poll()

      assert.deepEqual(callsStarting('region:'), [])
    })

    it('rescues the node again once the cooldown is over', async () => {
      await pinA()
      world.group.fixed = undefined
      await poll()
      assert.deepEqual(changes(), ['A'])

      world.calls = []
      world.logs = []
      world.group.fixed = undefined
      await jump(STICKY_PIN_RESTORE_COOLDOWN_MS)

      assert.deepEqual(changes(), ['A'])
      assert.deepEqual(world.logs, ['[AutoSelectSticky]: restored A after single probe blip\n'])
    })

    it('does not bring back a node that is confirmed dead', async () => {
      await pinA()
      world.group.fixed = undefined
      world.delayOf = () => 0

      await poll()

      assert.deepEqual(changes(), [])
      assert.deepEqual(world.logs, ['[AutoSelectSticky]: confirmed dead A\n'])
    })

    it('does not bring back a node that turned out to be in a restricted region', async () => {
      await pinA()
      world.group.fixed = undefined
      world.regionOf = () => restricted('ZZ')

      await poll()

      assert.deepEqual(changes(), [])
      assert.deepEqual(world.logs, [
        '[AutoSelectSticky]: dropped lost pin on region-restricted node A (region=ZZ)\n'
      ])
    })

    it('leaves the group alone when someone else fixed it during the check', async () => {
      await pinA()
      world.group.fixed = undefined
      world.onDetail = (call) => {
        if (call === 2) world.group.fixed = 'B'
      }

      await poll()

      assert.deepEqual(changes(), [])
      assert.deepEqual(world.logs, [])
    })

    it('leaves the group alone when the node left the group during the check', async () => {
      await pinA()
      world.group.fixed = undefined
      world.onDetail = (call) => {
        if (call === 2) world.group.all = ['B']
      }

      await poll()

      assert.deepEqual(changes(), [])
    })

    it('forgets the pin when it is released on purpose, so nothing is rescued', async () => {
      await pinA()
      sticky.notifyUnfixed(AUTO_SELECT_GROUP_NAME)
      world.group.fixed = undefined

      await poll()

      assert.deepEqual(callsStarting('delay:'), [])
      assert.deepEqual(changes(), [])
    })

    it('rechecks the region right after a deliberate release, even if the node is fixed again', async () => {
      await pinA()
      sticky.notifyUnfixed(AUTO_SELECT_GROUP_NAME)

      await poll()

      assert.deepEqual(callsStarting('region:'), ['region:A'])
    })

    it('ignores a release announced for another group', async () => {
      await pinA()
      sticky.notifyUnfixed('Sparkle-台湾')
      world.group.fixed = undefined

      await poll()

      assert.deepEqual(changes(), ['A'])
    })

    it('does not complete a rescue that was invalidated while the node was being checked', async () => {
      await pinA()
      world.group.fixed = undefined
      world.regionOf = () => {
        sticky.notifyUnfixed(AUTO_SELECT_GROUP_NAME)
        return ELIGIBLE
      }

      await poll()

      assert.deepEqual(changes(), [])
    })
  })

  describe('a pin that is already in place', () => {
    it('releases an orphan pin on a node that left the group', async () => {
      world.group = { type: 'Fallback', now: 'A', fixed: 'Z', all: ['A', 'B'] }
      sticky.start()

      await poll()

      assert.deepEqual(unfixes(), [`unfix:${AUTO_SELECT_GROUP_NAME}`])
      assert.deepEqual(world.logs, ['[AutoSelectSticky]: released orphan pin Z\n'])
    })

    it('releases the pin on a node confirmed to be in a restricted region', async () => {
      world.group = { type: 'Fallback', now: 'A', fixed: 'A', all: ['A', 'B'] }
      world.regionOf = () => restricted('HK')
      sticky.start()

      await poll()

      assert.deepEqual(unfixes(), [`unfix:${AUTO_SELECT_GROUP_NAME}`])
      assert.deepEqual(world.logs, [
        '[AutoSelectSticky]: unfixed region-restricted node A (region=HK)\n'
      ])
    })

    it('forgets a released restricted node instead of trying to rescue it', async () => {
      world.group = { type: 'Fallback', now: 'A', fixed: 'A', all: ['A', 'B'] }
      world.regionOf = () => restricted('HK')
      sticky.start()
      await poll()
      world.calls = []
      world.logs = []

      await poll()

      assert.deepEqual(callsStarting('delay:'), [])
      assert.deepEqual(world.logs, [])
    })

    it('asks about the region again when a node is fixed again after a gap', async () => {
      world.group = { type: 'Fallback', now: 'A', fixed: 'A', all: ['A', 'B'] }
      sticky.start()
      await poll()
      world.group.fixed = undefined
      world.delayOf = () => 0
      await poll()

      world.group.fixed = 'A'
      await poll()

      assert.deepEqual(callsStarting('region:'), ['region:A', 'region:A'])
    })

    it('keeps a pinned node whose region check has no verdict or an eligible one', async () => {
      world.group = { type: 'Fallback', now: 'A', fixed: 'A', all: ['A', 'B'] }
      world.regionOf = () => ({ eligible: false, definitive: false })
      sticky.start()

      await poll(2)
      world.regionOf = () => ELIGIBLE
      await jump(FIXED_NODE_REGION_RECHECK_MS)

      assert.deepEqual(unfixes(), [])
      assert.deepEqual(world.logs, [])
    })

    it('rechecks the region of a pinned node once per window, not on every poll', async () => {
      world.group = { type: 'Fallback', now: 'A', fixed: 'A', all: ['A', 'B'] }
      sticky.start()

      await poll(3)
      assert.deepEqual(callsStarting('region:'), ['region:A'])

      await jump(FIXED_NODE_REGION_RECHECK_MS)
      assert.deepEqual(callsStarting('region:'), ['region:A', 'region:A'])
    })

    it('rechecks the region at once when the pinned node is a different one', async () => {
      world.group = { type: 'Fallback', now: 'A', fixed: 'A', all: ['A', 'B'] }
      sticky.start()
      await poll()

      world.group.fixed = 'B'
      await poll()

      assert.deepEqual(callsStarting('region:'), ['region:A', 'region:B'])
    })
  })
})
