import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideStickyPin,
  INITIAL_STICKY_PIN_MEMORY,
  recordRestoredStickyPin,
  STICKY_PIN_RESTORE_COOLDOWN_MS,
  type AutoSelectGroupSnapshot,
  type StickyPinMemory
} from './autoSelectStickyPinCore'

function group(overrides: Partial<AutoSelectGroupSnapshot> = {}): AutoSelectGroupSnapshot {
  return { type: 'Fallback', now: 'A', fixed: '', all: ['A', 'B', 'C'], ...overrides }
}

describe('autoSelectStickyPinCore', () => {
  it('pins the node only after `now` stays the same for consecutive polls', () => {
    const first = decideStickyPin(group(), INITIAL_STICKY_PIN_MEMORY)
    assert.deepEqual(first.action, { kind: 'none' })
    assert.equal(first.memory.candidate, 'A')
    assert.equal(first.memory.stablePolls, 1)

    const second = decideStickyPin(group(), first.memory)
    assert.deepEqual(second.action, { kind: 'pin', node: 'A' })
    assert.deepEqual(second.memory, INITIAL_STICKY_PIN_MEMORY)
  })

  it('restarts the count when `now` changes, skipping the transient node after a pin is cleared', () => {
    const transient = decideStickyPin(group({ now: 'C' }), INITIAL_STICKY_PIN_MEMORY)
    const settled = decideStickyPin(group({ now: 'A' }), transient.memory)
    assert.deepEqual(settled.action, { kind: 'none' })
    assert.equal(settled.memory.candidate, 'A')
    assert.equal(settled.memory.stablePolls, 1)
    assert.deepEqual(decideStickyPin(group({ now: 'A' }), settled.memory).action, {
      kind: 'pin',
      node: 'A'
    })
  })

  it('records a live pin in memory and clears candidate observation', () => {
    const memory: StickyPinMemory = { ...INITIAL_STICKY_PIN_MEMORY, candidate: 'A', stablePolls: 1 }
    const decision = decideStickyPin(group({ fixed: 'B', now: 'B' }), memory)
    assert.deepEqual(decision.action, { kind: 'none' })
    assert.equal(decision.memory.pinned, 'B')
    assert.equal(decision.memory.candidate, '')
    assert.equal(decision.memory.stablePolls, 0)
  })

  it('requests a single-node verification when a live pin disappears while still in the group', () => {
    const whilePinned = decideStickyPin(group({ fixed: 'A', now: 'A' }), INITIAL_STICKY_PIN_MEMORY)
    const afterBlip = decideStickyPin(group({ fixed: '', now: 'B' }), whilePinned.memory, 1_000)
    assert.deepEqual(afterBlip.action, { kind: 'verify-lost-pin', node: 'A' })
    assert.equal(afterBlip.memory.pinned, '')
    assert.equal(afterBlip.memory.candidate, 'B')
    assert.equal(afterBlip.memory.stablePolls, 1)
  })

  it('does not re-verify the same node again within the restore cooldown window', () => {
    const restored = recordRestoredStickyPin('A', 10_000)
    const droppedSoon = decideStickyPin(
      group({ fixed: '', now: 'B' }),
      restored,
      10_000 + STICKY_PIN_RESTORE_COOLDOWN_MS - 1
    )
    assert.deepEqual(droppedSoon.action, { kind: 'none' })
    assert.equal(droppedSoon.memory.candidate, 'B')
    assert.equal(droppedSoon.memory.stablePolls, 1)
    assert.deepEqual(
      decideStickyPin(
        group({ fixed: '', now: 'B' }),
        droppedSoon.memory,
        10_000 + STICKY_PIN_RESTORE_COOLDOWN_MS
      ).action,
      { kind: 'pin', node: 'B' }
    )
  })

  it('allows re-verification again after the restore cooldown expires', () => {
    const restored = recordRestoredStickyPin('A', 10_000)
    const droppedLater = decideStickyPin(
      group({ fixed: '', now: 'B' }),
      restored,
      10_000 + STICKY_PIN_RESTORE_COOLDOWN_MS + 1
    )
    assert.deepEqual(droppedLater.action, { kind: 'verify-lost-pin', node: 'A' })
  })

  it('releases an orphan pin whose node is no longer in the group', () => {
    const decision = decideStickyPin(group({ fixed: 'GONE', now: 'A' }), INITIAL_STICKY_PIN_MEMORY)
    assert.deepEqual(decision.action, { kind: 'unfix', orphan: 'GONE' })
  })

  it('never pins when the group is not a fallback or `now` is not a member', () => {
    const stable: StickyPinMemory = { ...INITIAL_STICKY_PIN_MEMORY, candidate: 'A', stablePolls: 5 }
    assert.deepEqual(decideStickyPin(group({ type: 'URLTest' }), stable).action, { kind: 'none' })
    assert.deepEqual(decideStickyPin(group({ now: 'DIRECT' }), stable).action, { kind: 'none' })
    assert.deepEqual(decideStickyPin(group({ now: '' }), stable).action, { kind: 'none' })
  })
})
