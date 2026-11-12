import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DIAL_FAILURE_DEDUPE_MS, FAILOVER_HOLD_MS } from './groupFailoverCore'
import { TAIWAN, createHarness, flush, taiwanGroup } from './groupFailoverEngineHarness'

describe('group failover engine: holding and releasing its own pin', () => {
  it('lets a quarantined node back in exactly when the hold time is over', async () => {
    /** 第一次转移（A→C）后等待 waitMs，再触发第二次转移；返回第二次选中的节点。 */
    const secondTarget = async (waitMs: number): Promise<string | undefined> => {
      const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
      await h.failTwice(TAIWAN)
      assert.deepEqual(h.pins.at(-1), [TAIWAN, 'C'])
      h.groups[TAIWAN] = taiwanGroup('C', 'C')
      h.advance(waitMs)
      await h.failTwice(TAIWAN)
      return h.pins.at(-1)?.[1]
    }
    // failTwice 的第二条告警晚 40 s 到达，转移发生在「等待 + 40 s」之后；A 的隔离自第一次转移起算 10 分钟。
    assert.equal(await secondTarget(FAILOVER_HOLD_MS - 40_000 - 1), 'D')
    assert.equal(await secondTarget(FAILOVER_HOLD_MS - 40_000), 'A')
  })

  it('keeps owning the current pin when a stale release timer fires', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'D'])

    h.scheduled[0].task()
    await flush()

    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'B'])
    assert.doesNotMatch(h.logs.join(''), /reason=user-pin/)
  })

  it('stops owning the pin once it has handed the group back', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.scheduled[0].task()
    await flush()
    assert.deepEqual(h.unpins, [TAIWAN])

    h.groups[TAIWAN] = taiwanGroup('C', 'C')
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)

    assert.deepEqual(h.pins, [[TAIWAN, 'C']])
    assert.match(h.logs.join(''), /skipped group=Sparkle-台湾 reason=user-pin node=C/)
  })

  it('replaces its own earlier pin and cancels the old release timer', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.equal(h.scheduled.length, 2)
    assert.equal(h.scheduled[0].cancelled, true)
    assert.equal(h.scheduled[1].cancelled, false)
  })

  it('hands the group back to the kernel when the hold expires and the pin is still ours', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.scheduled[0].task()
    await flush()
    assert.deepEqual(h.unpins, [TAIWAN])
    assert.match(h.logs.join(''), /released group=Sparkle-台湾 node=C/)
  })

  it('does not unpin when the user or another flow has changed the pin meanwhile', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.groups[TAIWAN] = taiwanGroup('D', 'D')
    h.scheduled[0].task()
    await flush()
    assert.deepEqual(h.unpins, [])
  })

  it('ignores a release timer that fired for a pin the engine has since replaced', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'D'])

    h.scheduled[0].task()
    await flush()
    assert.deepEqual(h.unpins, [])
    assert.doesNotMatch(h.logs.join(''), /released/)

    h.scheduled[1].task()
    await flush()
    assert.deepEqual(h.unpins, [TAIWAN])
    assert.match(h.logs.join(''), /released group=Sparkle-台湾 node=D/)
  })

  it('stops treating the pin as its own once the user has taken it over', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.groups[TAIWAN] = taiwanGroup('D', 'D')
    h.scheduled[0].task()
    await flush()
    assert.equal(h.scheduled.length, 1)

    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])
    assert.match(h.logs.join(''), /skipped group=Sparkle-台湾 reason=user-pin node=D/)
  })

  it('forgets the pin without unpinning when the group has disappeared', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    delete h.groups[TAIWAN]
    h.scheduled[0].task()
    await flush()
    assert.deepEqual(h.unpins, [])
    assert.equal(h.scheduled.length, 1)
  })

  it('keeps ownership and retries when handing the group back fails', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.behavior.unpinError = new Error('controller down')
    h.scheduled[0].task()
    await flush()
    assert.match(h.logs.join(''), /release failed group=Sparkle-台湾 err=controller down/)
    assert.equal(h.scheduled.length, 2)
    assert.equal(h.scheduled[1].delayMs, FAILOVER_HOLD_MS)

    h.behavior.unpinError = undefined
    h.scheduled[1].task()
    await flush()
    assert.deepEqual(h.unpins, [TAIWAN])
    assert.match(h.logs.join(''), /released group=Sparkle-台湾 node=C/)
  })

  it('does not mistake its own pin for a user pin after a failed release', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.behavior.loadError = new Error('controller down')
    h.scheduled[0].task()
    await flush()
    assert.match(h.logs.join(''), /release failed/)

    h.behavior.loadError = undefined
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'D'])
    assert.doesNotMatch(h.logs.join(''), /reason=user-pin/)
  })

  it('keeps the switch and its hold timer when the logger fails', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    h.behavior.logError = new Error('disk full')
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])
    assert.equal(h.scheduled.length, 1)

    h.scheduled[0].task()
    await flush()
    assert.deepEqual(h.unpins, [TAIWAN])
  })
})
