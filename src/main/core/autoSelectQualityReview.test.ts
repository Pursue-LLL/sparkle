import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aliveLeaf,
  callsStarting,
  changes,
  ELIGIBLE,
  jump,
  poll,
  POLL_INTERVAL_MS,
  restricted,
  useStickyPinRig,
  world,
  measured,
  measures,
  scriptReadings,
  UNAVAILABLE,
  type ReadingScript
} from './autoSelectStickyPinRig'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import { REVIEW_INTERVAL_MS, UNVERIFIED_PIN_REVIEW_MS } from './sparkleNodeQualityCore'

const QUALITY = '[AutoSelectQuality]: '

/** 确认读数要等 45 秒，轮询 3 秒一轮；两次读数之间超过 5 分钟就不再算确认。 */
const CONFIRM_POLLS = 45_000 / POLL_INTERVAL_MS
const CONFIRM_WINDOW_MS = 5 * 60_000
const UNKNOWN_RETRY_POLLS = (5 * 60_000) / POLL_INTERVAL_MS

const decisions = (): string[] =>
  world.calls.filter((call) => /^(measure|sink|change|close|rebuild)/.test(call))

describe('quality review', () => {
  const rig = useStickyPinRig({ guard: 'real' })

  /** 到期后读到第一次劣化读数，停在「等确认读数」。 */
  async function firstDegradedReading(table: ReadingScript = { A: { primary: measured(40) } }) {
    scriptReadings(table)
    await jump(REVIEW_INTERVAL_MS)
    assert.deepEqual(measures(), ['measure:primary:A'])
    world.calls = []
  }

  describe('a node the gate pinned', () => {
    it('is left alone while healthy and looked at again one interval later', async () => {
      await rig.pinA()

      await jump(REVIEW_INTERVAL_MS - POLL_INTERVAL_MS)
      assert.deepEqual(measures(), [], 'not due yet')
      await poll()
      assert.deepEqual(measures(), ['measure:primary:A'])
      assert.deepEqual(world.logs, [], 'a healthy review is silent')

      world.calls = []
      await jump(REVIEW_INTERVAL_MS - POLL_INTERVAL_MS)
      assert.deepEqual(measures(), [])
      await poll()
      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    it('is replaced only after a second low reading confirms the first', async () => {
      await rig.pinA()
      await firstDegradedReading()
      assert.deepEqual(world.logs, [
        `${QUALITY}A looks degraded (google 40 KB/s), checking again\n`
      ])
      assert.deepEqual(changes(), [])
      world.logs = []

      await poll(CONFIRM_POLLS - 1)
      assert.deepEqual(measures(), [], 'too early to confirm')

      await poll()
      assert.deepEqual(decisions(), [
        'measure:primary:A',
        'measure:primary:B',
        'measure:control:B',
        'sink:A',
        `change:${AUTO_SELECT_GROUP_NAME}:B`,
        'close:A',
        'rebuild'
      ])
      assert.deepEqual(world.logs, [
        `${QUALITY}A confirmed degraded (google 40 KB/s)\n`,
        `${QUALITY}replaced degraded A with B (google 400 KB/s, control 400 KB/s)\n`
      ])
    })

    it('keeps its place when the confirming reading is healthy again', async () => {
      await rig.pinA()
      await firstDegradedReading()
      scriptReadings({})
      world.logs = []

      await poll(CONFIRM_POLLS)

      assert.deepEqual(measures(), ['measure:primary:A'])
      assert.deepEqual(changes(), [])
      assert.deepEqual(world.logs, [])

      world.calls = []
      await jump(REVIEW_INTERVAL_MS - POLL_INTERVAL_MS)
      assert.deepEqual(measures(), [])
      await poll()
      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    it('counts a second low reading that comes too late as a new first one', async () => {
      await rig.pinA()
      await firstDegradedReading()
      world.logs = []

      await jump(CONFIRM_WINDOW_MS + POLL_INTERVAL_MS)

      assert.deepEqual(changes(), [])
      assert.deepEqual(world.logs, [
        `${QUALITY}A looks degraded (google 40 KB/s), checking again\n`
      ])
    })

    it('is reviewed in its turn once it has replaced the old one', async () => {
      await rig.pinA()
      await firstDegradedReading()
      await poll(CONFIRM_POLLS)
      assert.deepEqual(changes(), ['B'])
      scriptReadings({})
      world.calls = []

      await jump(REVIEW_INTERVAL_MS)

      assert.deepEqual(measures(), ['measure:primary:B'])
    })
  })

  describe('when no replacement is good enough', () => {
    const confirmDegradation = async (
      table: ReadingScript,
      leaves = [aliveLeaf('A'), aliveLeaf('B')]
    ) => {
      await rig.pinA(leaves)
      await firstDegradedReading(table)
      world.logs = []
      await poll(CONFIRM_POLLS)
    }

    it('keeps the node, sinks nobody and looks again one interval later', async () => {
      await confirmDegradation({ A: { primary: measured(40) }, B: { primary: measured(30) } })

      assert.deepEqual(world.logs, [
        `${QUALITY}A confirmed degraded (google 40 KB/s)\n`,
        `${QUALITY}skipped B (google 30 KB/s)\n`,
        `${QUALITY}keeping degraded A (no replacement reached the line)\n`
      ])
      assert.deepEqual(changes(), [])
      assert.deepEqual(callsStarting('sink:'), [])
      assert.deepEqual(callsStarting('close:'), [])
      assert.deepEqual(callsStarting('rebuild'), [])

      world.calls = []
      await jump(REVIEW_INTERVAL_MS - POLL_INTERVAL_MS)
      assert.deepEqual(measures(), [])
      await poll()
      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    it('keeps the node when no other node is known to be alive', async () => {
      await confirmDegradation({ A: { primary: measured(40) } }, [aliveLeaf('A')])

      assert.deepEqual(world.logs, [
        `${QUALITY}A confirmed degraded (google 40 KB/s)\n`,
        `${QUALITY}keeping degraded A (no replacement reached the line)\n`
      ])
      assert.deepEqual(changes(), [])
    })

    it('tries again soon when the probe channel failed during the search', async () => {
      await rig.pinA()
      await firstDegradedReading()
      world.readingOf = (node) => (node === 'A' ? measured(40) : UNAVAILABLE)
      world.logs = []
      await poll(CONFIRM_POLLS)

      assert.deepEqual(world.logs, [
        `${QUALITY}A confirmed degraded (google 40 KB/s)\n`,
        `${QUALITY}keeping degraded A (probe channel unavailable)\n`
      ])
      world.calls = []
      await jump(UNVERIFIED_PIN_REVIEW_MS - POLL_INTERVAL_MS)
      assert.deepEqual(measures(), [])
      await poll()
      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    it('tries again soon when the search itself failed', async () => {
      await rig.pinA()
      await firstDegradedReading()
      world.providersError = new Error('boom')
      world.logs = []

      await poll(CONFIRM_POLLS)

      assert.deepEqual(world.logs, [
        `${QUALITY}A confirmed degraded (google 40 KB/s)\n`,
        `${QUALITY}replacement failed, keeping A: boom\n`
      ])
      assert.deepEqual(changes(), [])
      world.calls = []
      await jump(UNVERIFIED_PIN_REVIEW_MS - POLL_INTERVAL_MS)
      assert.deepEqual(measures(), [])
      await poll()
      assert.deepEqual(measures(), ['measure:primary:A'])
    })
  })

  describe('choosing the replacement', () => {
    it('sinks every node it had to pass over on the way', async () => {
      await rig.pinA([aliveLeaf('A'), aliveLeaf('B'), aliveLeaf('C')])
      world.group.all = ['A', 'B', 'C']
      await firstDegradedReading({ A: { primary: measured(40) }, B: { primary: measured(50) } })

      await poll(CONFIRM_POLLS)

      assert.deepEqual(callsStarting('sink:'), ['sink:A,B'])
      assert.deepEqual(changes(), ['C'])
    })

    it('skips nodes that are sunk, restricted or the node itself', async () => {
      await rig.pinA([aliveLeaf('A'), aliveLeaf('B'), aliveLeaf('C'), aliveLeaf('D')])
      world.group.all = ['A', 'B', 'C', 'D']
      world.sunk = new Set(['B'])
      world.regionOf = (node) => (node === 'C' ? restricted('CN') : ELIGIBLE)
      await firstDegradedReading()

      await poll(CONFIRM_POLLS)

      assert.deepEqual(measures(), ['measure:primary:A', 'measure:primary:D', 'measure:control:D'])
      assert.deepEqual(callsStarting('sink:'), ['sink:A'])
      assert.deepEqual(changes(), ['D'])
    })

    it('leaves the group alone when somebody fixed another node during the search', async () => {
      await rig.pinA()
      world.group.all = ['A', 'B', 'X']
      await firstDegradedReading()
      world.onMeasure = (node) => {
        if (node === 'B') world.group.fixed = 'X'
      }

      await poll(CONFIRM_POLLS)

      assert.deepEqual(changes(), [])
      assert.deepEqual(callsStarting('sink:'), [])
      assert.deepEqual(callsStarting('close:'), [])
    })

    it('leaves the group alone when the chosen replacement left the group during the search', async () => {
      await rig.pinA()
      await firstDegradedReading()
      world.onMeasure = (node) => {
        if (node === 'B') world.group.all = ['A']
      }

      await poll(CONFIRM_POLLS)

      assert.deepEqual(changes(), [])
      assert.deepEqual(callsStarting('sink:'), [])
    })

    it('drops a review result that a release invalidated meanwhile', async () => {
      await rig.pinA()
      await firstDegradedReading()
      world.logs = []
      world.onMeasure = () => rig.notifyUnfixed(AUTO_SELECT_GROUP_NAME)

      await poll(CONFIRM_POLLS)

      assert.deepEqual(changes(), [])
      assert.deepEqual(world.logs, [])
    })
  })

  describe('a probe channel that cannot answer', () => {
    it('says nothing about the node and asks again in five minutes', async () => {
      await rig.pinA()
      world.readingOf = () => UNAVAILABLE

      await jump(REVIEW_INTERVAL_MS)
      assert.deepEqual(measures(), ['measure:primary:A'])
      assert.deepEqual(world.logs, [])
      assert.deepEqual(changes(), [])

      world.calls = []
      await poll(UNKNOWN_RETRY_POLLS - 1)
      assert.deepEqual(measures(), [])
      await poll()
      assert.deepEqual(measures(), ['measure:primary:A'])
    })
  })
})
