import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aliveLeaf,
  callsStarting,
  deadLeaf,
  ELIGIBLE,
  jump,
  restricted,
  useStickyPinRig,
  world,
  measured,
  measures,
  scriptReadings,
  UNAVAILABLE
} from './autoSelectStickyPinRig'
import {
  ADMISSION_KBPS,
  ADMISSION_MEMORY_MS,
  DEGRADED_KBPS,
  REVIEW_INTERVAL_MS,
  UNVERIFIED_PIN_REVIEW_MS
} from './sparkleNodeQualityCore'
import type { PinAdmission } from './autoSelectQualityGuard'

const QUALITY = '[AutoSelectQuality]: '
const groupOf = (all: string[]) => ({ type: 'Fallback', now: all[0], all })
const verifiedPin = (node: string): PinAdmission => ({
  node,
  verified: true,
  sunk: [],
  abandoned: undefined
})

describe('quality admission', () => {
  const rig = useStickyPinRig({ guard: 'real' })

  describe('admitPinCandidate', () => {
    it('admits a healthy candidate after one reading on each target', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.deepEqual(admission, verifiedPin('A'))
      assert.deepEqual(measures(), ['measure:primary:A', 'measure:control:A'])
      assert.deepEqual(world.logs, [`${QUALITY}admitted A (google 400 KB/s, control 400 KB/s)\n`])
    })

    it('moves on to the next alive node when the candidate downloads too slowly', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      scriptReadings({ A: { primary: measured(40) } })

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.deepEqual(admission, { node: 'B', verified: true, sunk: ['A'], abandoned: 'A' })
      assert.deepEqual(callsStarting('sink:'), ['sink:A'])
      assert.deepEqual(world.logs, [
        `${QUALITY}skipped A (google 40 KB/s)\n`,
        `${QUALITY}admitted B instead of A (google 400 KB/s, control 400 KB/s)\n`
      ])
    })

    it('keeps the old connections of a candidate that was only below the admission line', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      scriptReadings({ A: { primary: measured(ADMISSION_KBPS - 1) } })

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.equal(admission.node, 'B')
      assert.deepEqual(admission.sunk, ['A'])
      assert.equal(admission.abandoned, undefined)
    })

    it('treats a candidate that the control site flags as degraded', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      scriptReadings({ A: { control: measured(DEGRADED_KBPS - 1) } })

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.equal(admission.node, 'B')
      assert.equal(admission.abandoned, 'A')
    })

    it('sinks nobody when no node passes, so the pool never gets worse for nothing', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      scriptReadings({ A: { primary: measured(40) }, B: { primary: measured(30) } })

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.deepEqual(admission, { ...verifiedPin('A'), verified: false })
      assert.deepEqual(callsStarting('sink:'), [])
      assert.deepEqual(world.logs, [
        `${QUALITY}skipped A (google 40 KB/s)\n`,
        `${QUALITY}skipped B (google 30 KB/s)\n`,
        `${QUALITY}no candidate reached ${ADMISSION_KBPS} KB/s, pinning A as is\n`
      ])
    })

    it('lets the candidate through unverified when the probe channel is unavailable', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      world.readingOf = () => UNAVAILABLE

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.deepEqual(admission, { ...verifiedPin('A'), verified: false })
      assert.deepEqual(measures(), ['measure:primary:A'], 'it does not keep trying')
      assert.deepEqual(world.logs, [
        `${QUALITY}could not verify A (probe channel unavailable), pinning it unchecked\n`
      ])
    })

    it('lets the candidate through when the controller cannot be read', async () => {
      world.providersError = new Error('boom')

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.deepEqual(admission, { ...verifiedPin('A'), verified: false })
      assert.deepEqual(world.logs, [
        `${QUALITY}admission failed for A, pinning it unchecked: boom\n`
      ])
    })

    it('never measures a node that is already sunk', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B'), aliveLeaf('C')]
      world.sunk = new Set(['B'])
      scriptReadings({ A: { primary: measured(40) } })

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B', 'C']))

      assert.equal(admission.node, 'C')
      assert.ok(!measures().some((call) => call.endsWith(':B')))
    })

    it('regards a sunk candidate as degraded when it has to move off it', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      world.sunk = new Set(['A'])

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.deepEqual(admission, { node: 'B', verified: true, sunk: [], abandoned: 'A' })
      assert.ok(!measures().some((call) => call.endsWith(':A')))
    })

    it('only considers nodes known to be alive as replacements', async () => {
      world.leaves = [aliveLeaf('A'), deadLeaf('B'), { name: 'C' }]
      scriptReadings({ A: { primary: measured(40) } })

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B', 'C']))

      assert.equal(
        admission.node,
        'A',
        'neither a dead node nor an unmeasured one is a replacement'
      )
      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    it('skips a replacement in a restricted region without sinking it', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B'), aliveLeaf('C')]
      world.regionOf = (node) => (node === 'B' ? restricted('CN') : ELIGIBLE)
      scriptReadings({ A: { primary: measured(40) } })

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B', 'C']))

      assert.equal(admission.node, 'C')
      assert.deepEqual(admission.sunk, ['A'])
      assert.ok(!measures().some((call) => call.endsWith(':B')))
    })

    it('does not measure a node again within the memory window, and does after it', async () => {
      world.leaves = [aliveLeaf('A')]
      await rig.guard.admitPinCandidate('A', groupOf(['A']))
      world.calls = []

      await jump(ADMISSION_MEMORY_MS - 1)
      const remembered = await rig.guard.admitPinCandidate('A', groupOf(['A']))
      assert.deepEqual(measures(), [])
      assert.equal(remembered.verified, true)

      await jump(1)
      await rig.guard.admitPinCandidate('A', groupOf(['A']))
      assert.deepEqual(measures(), ['measure:primary:A', 'measure:control:A'])
    })

    it('forgets what it admitted once the guard is reset by a release', async () => {
      world.leaves = [aliveLeaf('A')]
      await rig.guard.admitPinCandidate('A', groupOf(['A']))
      rig.guard.resetQualityGuard()
      world.calls = []

      await rig.guard.admitPinCandidate('A', groupOf(['A']))

      assert.deepEqual(measures(), ['measure:primary:A', 'measure:control:A'])
    })

    it('measures the candidate first even when it has no probe samples yet', async () => {
      world.leaves = [{ name: 'A' }, aliveLeaf('B')]
      scriptReadings({ A: { primary: measured(40) } })

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.equal(admission.node, 'B')
      assert.deepEqual(measures().slice(0, 1), ['measure:primary:A'])
    })

    it('lets a replacement through when its region check has no verdict', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      world.regionOf = (node) => (node === 'B' ? { eligible: false, definitive: false } : ELIGIBLE)
      scriptReadings({ A: { primary: measured(40) } })

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.equal(admission.node, 'B')
    })

    it('abandons a walk that a release invalidated, without sinking anything', async () => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      scriptReadings({ A: { primary: measured(40) } })
      world.onMeasure = () => rig.guard.resetQualityGuard()

      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))

      assert.deepEqual(admission, { ...verifiedPin('A'), verified: false })
      assert.deepEqual(callsStarting('sink:'), [])
      assert.deepEqual(world.logs, [])
    })
  })

  describe('settlePinAdmission', () => {
    const slowCandidate = async (): Promise<PinAdmission> => {
      world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
      scriptReadings({ A: { primary: measured(40) } })
      return rig.guard.admitPinCandidate('A', groupOf(['A', 'B']))
    }

    it('closes the old connections first and then rewrites the provider', async () => {
      const admission = await slowCandidate()
      world.calls = []

      await rig.guard.settlePinAdmission(admission, true)

      assert.deepEqual(world.calls, ['close:A', 'rebuild'])
    })

    it('still rewrites the provider when the pin did not happen, but touches no connection', async () => {
      const admission = await slowCandidate()
      world.calls = []

      await rig.guard.settlePinAdmission(admission, false)

      assert.deepEqual(world.calls, ['rebuild'])
    })

    it('does not rewrite the provider when nothing was sunk', async () => {
      world.leaves = [aliveLeaf('A')]
      const admission = await rig.guard.admitPinCandidate('A', groupOf(['A']))
      world.calls = []

      await rig.guard.settlePinAdmission(admission, true)

      assert.deepEqual(world.calls, [])
    })

    it('still rewrites the provider when closing the old connections fails', async () => {
      const admission = await slowCandidate()
      world.logs = []
      world.closeError = new Error('boom')

      await rig.guard.settlePinAdmission(admission, true)

      assert.ok(world.calls.includes('rebuild'))
      assert.deepEqual(world.logs, [`${QUALITY}could not close connections of A: boom\n`])
    })

    it('starts the review clock of a verified pin at the regular interval', async () => {
      await rig.guard.settlePinAdmission(verifiedPin('A'), true)
      const group = { ...groupOf(['A', 'B']), fixed: 'A' }

      await jump(REVIEW_INTERVAL_MS - 1)
      await rig.guard.reviewPinnedNode(group)
      assert.deepEqual(measures(), [])

      await jump(1)
      await rig.guard.reviewPinnedNode(group)
      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    it('starts the review clock of an unchecked pin much sooner', async () => {
      await rig.guard.settlePinAdmission({ ...verifiedPin('A'), verified: false }, true)
      const group = { ...groupOf(['A', 'B']), fixed: 'A' }

      await jump(UNVERIFIED_PIN_REVIEW_MS - 1)
      await rig.guard.reviewPinnedNode(group)
      assert.deepEqual(measures(), [])

      await jump(1)
      await rig.guard.reviewPinnedNode(group)
      assert.deepEqual(measures(), ['measure:primary:A'])
    })

    it('starts no review when the pin did not happen', async () => {
      await rig.guard.settlePinAdmission(verifiedPin('A'), false)

      await jump(REVIEW_INTERVAL_MS)
      await rig.guard.reviewPinnedNode({ ...groupOf(['A', 'B']), fixed: 'A' })

      assert.deepEqual(measures(), [])
    })
  })
})
