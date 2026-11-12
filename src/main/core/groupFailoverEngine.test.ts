import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DIAL_FAILURE_DEDUPE_MS, FAILOVER_HOLD_MS } from './groupFailoverCore'
import { TAIWAN, alertFor, createHarness, flush, taiwanGroup } from './groupFailoverEngineHarness'

describe('group failover engine', () => {
  it('switches the group to the fastest healthy node after two failed bursts and pins it', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.engine.handleAlert(alertFor(TAIWAN))
    assert.deepEqual(h.pins, [])
    h.advance(40_000)
    await h.engine.handleAlert(alertFor(TAIWAN))
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])
    assert.equal(h.scheduled.length, 1)
    assert.equal(h.scheduled[0].delayMs, FAILOVER_HOLD_MS)
    assert.match(h.logs.join(''), /switched group=Sparkle-台湾 from=A to=C delay=90ms/)
  })

  it('does not switch on a single alert or a burst of simultaneous alerts', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    for (let index = 0; index < 8; index += 1) {
      await h.engine.handleAlert(alertFor(TAIWAN))
    }
    assert.deepEqual(h.pins, [])
    assert.deepEqual(h.loads, [])
  })

  it('ignores alerts for groups the policy does not fail over and unrelated logs', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    for (const group of ['自动选择', '🎯 Cursor 专用', 'grok 专用', '订阅自带组']) {
      await h.failTwice(group)
    }
    await h.engine.handleAlert({ type: 'warning', payload: 'something else entirely' })
    assert.deepEqual(h.loads, [])
    assert.deepEqual(h.pins, [])
  })

  it('quarantines the failing node so a later failover moves on to the next best node', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])

    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'D'])

    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'B'])
  })

  it('leaves a user pin alone and says why', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A', 'A') })
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins, [])
    assert.deepEqual(h.scheduled, [])
    assert.match(h.logs.join(''), /skipped group=Sparkle-台湾 reason=user-pin node=A/)
  })

  it('records nothing when the pin is refused', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    h.behavior.pinResult = false
    await h.failTwice(TAIWAN)
    assert.equal(h.pins.length, 1)
    assert.deepEqual(h.scheduled, [])
    assert.doesNotMatch(h.logs.join(''), /switched/)

    h.behavior.pinResult = true
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'C'])
  })

  it('does nothing when the group cannot be read', async () => {
    const h = createHarness({})
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.loads, [TAIWAN])
    assert.deepEqual(h.pins, [])
    assert.deepEqual(h.logs, [])
  })

  it('reports a skip without a node when the group is not a url-test group', async () => {
    const h = createHarness({ [TAIWAN]: { ...taiwanGroup('A'), type: 'Selector' } })
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.logs, ['[GroupFailover]: skipped group=Sparkle-台湾 reason=not-url-test\n'])
    assert.deepEqual(h.pins, [])
  })

  it('survives a failing controller call and keeps handling later failovers', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    h.behavior.loadError = new Error('controller down')
    await h.failTwice(TAIWAN)
    assert.match(h.logs.join(''), /failover failed group=Sparkle-台湾 err=controller down/)

    h.behavior.loadError = undefined
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])
  })

  it('runs failovers for different groups one after another', async () => {
    const japan = { ...taiwanGroup('A'), name: 'Sparkle-日本' }
    const h = createHarness({ [TAIWAN]: taiwanGroup('A'), 'Sparkle-日本': japan })
    h.behavior.loadDelayMs = 5
    await Promise.all([h.failTwice(TAIWAN), h.failTwice('Sparkle-日本')])
    assert.deepEqual(h.pins.map(([group]) => group).sort(), [TAIWAN, 'Sparkle-日本'].sort())
    assert.equal(h.load.maxActive, 1)
  })

  it('subscribes once and feeds subscribed alerts into the engine', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    h.engine.start()
    h.engine.start()
    assert.equal(h.listeners.length, 1)
    h.listeners[0](alertFor(TAIWAN))
    h.advance(40_000)
    h.listeners[0](alertFor(TAIWAN))
    await flush()
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])
  })
})
