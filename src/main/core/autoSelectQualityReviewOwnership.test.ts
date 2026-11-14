import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aliveLeaf,
  changes,
  deadLeaf,
  jump,
  measures,
  poll,
  useStickyPinRig,
  world
} from './autoSelectStickyPinRig'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import { REVIEW_INTERVAL_MS } from './sparkleNodeQualityCore'

describe('quality review ownership', () => {
  const rig = useStickyPinRig({ guard: 'real' })

  describe('the review state', () => {
    it('only applies to the node the gate pinned, whatever the group says is fixed now', async () => {
      await rig.guard.settlePinAdmission(
        { node: 'A', verified: true, sunk: [], abandoned: undefined },
        true
      )
      await jump(REVIEW_INTERVAL_MS)

      await rig.guard.reviewPinnedNode({ type: 'Fallback', now: 'M', all: ['A', 'M'], fixed: 'M' })

      assert.deepEqual(measures(), [])
    })
  })

  describe('a pin the gate did not place', () => {
    it('is never measured, however long it stays', async () => {
      world.group = { type: 'Fallback', now: 'M', fixed: 'M', all: ['A', 'B', 'M'] }
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      rig.start()

      await poll(2)
      await jump(REVIEW_INTERVAL_MS * 2)

      assert.deepEqual(measures(), [])
    })

    it('is forgotten as soon as somebody fixes another node, even if they switch back', async () => {
      await rig.pinA()
      world.group.all = ['A', 'B', 'M']
      world.group.fixed = 'M'
      await poll()
      world.group.fixed = 'A'
      await poll()

      await jump(REVIEW_INTERVAL_MS)

      assert.deepEqual(measures(), [])
    })

    it('is not reviewed after a deliberate release, even when the same node is fixed by hand', async () => {
      await rig.pinA()
      rig.notifyUnfixed(AUTO_SELECT_GROUP_NAME)
      world.group.fixed = 'A'

      await jump(REVIEW_INTERVAL_MS)

      assert.deepEqual(measures(), [])
    })
  })

  describe('a pin that mihomo clears', () => {
    it('is still reviewed after the poller put it back', async () => {
      await rig.pinA()
      world.group.fixed = undefined
      await poll()
      assert.deepEqual(changes(), ['A'], 'put back by the recovery path')
      world.calls = []

      await jump(REVIEW_INTERVAL_MS)

      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    /** 节点真的死了：既不会被救回，也不会被重新钉住，固定会一直处于清除状态。 */
    async function clearPinForGood(polls: number): Promise<void> {
      await rig.pinA()
      world.leaves = [deadLeaf('A'), deadLeaf('B')]
      world.delayOf = () => 0
      world.group.fixed = undefined
      await poll(polls)
      assert.deepEqual(changes(), [], 'nothing pinned the group again meanwhile')
      world.group.fixed = 'A'
      world.calls = []
    }

    it('is still reviewed when it stayed cleared for the whole grace period', async () => {
      await clearPinForGood(rig.guard.PIN_LOSS_GRACE_POLLS)

      await jump(REVIEW_INTERVAL_MS)

      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    it('counts the time cleared afresh each time the pin comes back', async () => {
      await rig.pinA()
      world.leaves = [deadLeaf('A'), deadLeaf('B')]
      world.delayOf = () => 0
      const almostTooLong = rig.guard.PIN_LOSS_GRACE_POLLS - 1

      for (let round = 0; round < 3; round += 1) {
        world.group.fixed = undefined
        await poll(almostTooLong)
        world.group.fixed = 'A'
        await poll()
      }
      world.calls = []
      await jump(REVIEW_INTERVAL_MS)

      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    it('stops being treated as the gate’s once it stayed cleared longer than that', async () => {
      await clearPinForGood(rig.guard.PIN_LOSS_GRACE_POLLS + 1)

      await jump(REVIEW_INTERVAL_MS)

      assert.deepEqual(measures(), [])
    })
  })
})
