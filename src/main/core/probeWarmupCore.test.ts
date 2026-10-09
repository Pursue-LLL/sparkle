import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createProbeWarmupState } from './probeWarmupCore'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('probeWarmupCore', () => {
  it('notifies only on actual transitions', () => {
    const changes: boolean[] = []
    const state = createProbeWarmupState((active) => changes.push(active), 1_000)

    state.end()
    state.begin()
    state.begin()
    assert.equal(state.isActive(), true)
    state.end()
    state.end()

    assert.deepEqual(changes, [true, false])
    assert.equal(state.isActive(), false)
  })

  it('closes the window by itself after maxMs', async () => {
    const changes: boolean[] = []
    const state = createProbeWarmupState((active) => changes.push(active), 20)

    state.begin()
    await sleep(60)

    assert.equal(state.isActive(), false)
    assert.deepEqual(changes, [true, false])
  })

  it('restarting the window re-arms the safety timer', async () => {
    const state = createProbeWarmupState(() => undefined, 40)

    state.begin()
    await sleep(25)
    state.begin()
    await sleep(25)
    assert.equal(state.isActive(), true)

    await sleep(40)
    assert.equal(state.isActive(), false)
  })
})
