import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aliveLeaf,
  callsStarting,
  changes,
  jump,
  measured,
  measures,
  poll,
  restricted,
  scriptReadings,
  UNAVAILABLE,
  useStickyPinRig,
  world
} from './autoSelectStickyPinRig'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import { UNVERIFIED_PIN_REVIEW_MS } from './sparkleNodeQualityCore'

const QUALITY = '[AutoSelectQuality]: '
const STICKY = '[AutoSelectSticky]: '

describe('quality admission when the poller pins', () => {
  const rig = useStickyPinRig({ guard: 'real' })

  it('pins the replacement instead of a slow candidate, then frees the old node', async () => {
    world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
    scriptReadings({ A: { primary: measured(40) } })
    rig.start()

    await poll(2)

    assert.deepEqual(changes(), ['B'])
    assert.deepEqual(
      world.calls.filter((call) => /^(sink|change|close|rebuild)/.test(call)),
      [
        'sink:A',
        `change:${AUTO_SELECT_GROUP_NAME}:B`,
        `close:${AUTO_SELECT_GROUP_NAME}:A`,
        'rebuild'
      ]
    )
    assert.deepEqual(world.logs, [
      `${QUALITY}skipped A (google 40 KB/s)\n`,
      `${QUALITY}admitted B instead of A (google 400 KB/s, control 400 KB/s)\n`,
      `${STICKY}pinned B\n`
    ])
  })

  it('pins a healthy candidate exactly as it would without the gate', async () => {
    world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
    rig.start()

    await poll(2)

    assert.deepEqual(changes(), ['A'])
    assert.deepEqual(callsStarting('close:'), [])
    assert.deepEqual(callsStarting('rebuild'), [])
  })

  it('leaves the group alone when it moved on during the walk, and picks the walk up again later', async () => {
    world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
    scriptReadings({ A: { primary: measured(40) } })
    world.onMeasure = (node, role) => {
      if (node === 'B' && role === 'primary') world.group.now = 'B'
    }
    rig.start()

    await poll(2)
    assert.deepEqual(changes(), [], 'the candidate is no longer the selected node')
    assert.deepEqual(callsStarting('close:'), [])
    assert.deepEqual(
      callsStarting('rebuild'),
      ['rebuild'],
      'A was still sunk, so the provider is rewritten'
    )

    world.calls = []
    await poll(2)
    assert.deepEqual(changes(), ['B'])
    assert.deepEqual(measures(), [], 'B was admitted a moment ago and is not measured again')
  })

  it('pins nothing when the admitted node left the group during the walk', async () => {
    world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
    scriptReadings({ A: { primary: measured(40) } })
    world.onMeasure = (node, role) => {
      if (node === 'B' && role === 'primary') world.group.all = ['A']
    }
    rig.start()

    await poll(2)

    assert.deepEqual(changes(), [])
    assert.deepEqual(callsStarting('rebuild'), ['rebuild'], 'A was still sunk')
  })

  it('runs no quality probe for a candidate in a restricted region', async () => {
    world.leaves = [aliveLeaf('A')]
    world.regionOf = () => restricted('CN')
    rig.start()

    await poll(3)

    assert.deepEqual(measures(), [])
    assert.deepEqual(changes(), [])
    assert.deepEqual(world.logs, [`${STICKY}rejected region-restricted node A (region=CN)\n`])
  })

  it('does not pin anything when a release invalidated the walk', async () => {
    world.leaves = [aliveLeaf('A'), aliveLeaf('B')]
    scriptReadings({ A: { primary: measured(40) } })
    world.onMeasure = () => rig.notifyUnfixed(AUTO_SELECT_GROUP_NAME)
    rig.start()

    await poll(2)

    assert.deepEqual(changes(), [])
    assert.deepEqual(callsStarting('sink:'), [])
  })

  it('pins an unchecked candidate while the probe channel is down, and checks it soon after', async () => {
    world.leaves = [aliveLeaf('A')]
    world.readingOf = () => UNAVAILABLE
    rig.start()
    await poll(2)
    assert.deepEqual(changes(), ['A'])

    world.readingOf = () => measured(400)
    world.calls = []
    await jump(UNVERIFIED_PIN_REVIEW_MS)

    assert.deepEqual(measures(), ['measure:primary:A'])
  })
})
