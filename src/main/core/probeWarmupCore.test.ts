import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createProbeWarmupState } from './probeWarmupCore'

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

  it('closes the window by itself after maxMs', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const changes: boolean[] = []
    const state = createProbeWarmupState((active) => changes.push(active), 20)

    state.begin()
    t.mock.timers.tick(19)
    assert.equal(state.isActive(), true)

    t.mock.timers.tick(1)
    assert.equal(state.isActive(), false)
    assert.deepEqual(changes, [true, false])
  })

  it('restarting the window re-arms the safety timer', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const state = createProbeWarmupState(() => undefined, 40)

    state.begin()
    t.mock.timers.tick(25)
    state.begin()
    // 距第一次 begin 已 50 ms：若没有重新计时，窗口早在 40 ms 时就关了
    t.mock.timers.tick(25)
    assert.equal(state.isActive(), true)

    t.mock.timers.tick(15)
    assert.equal(state.isActive(), false)
  })

  it('does not close the window early once end and begin interleave', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const changes: boolean[] = []
    const state = createProbeWarmupState((active) => changes.push(active), 40)

    state.begin()
    t.mock.timers.tick(30)
    state.end()
    state.begin()
    // 第一次 begin 的定时器已被 end 清掉，不能在 40 ms 处误关第二个窗口
    t.mock.timers.tick(30)

    assert.equal(state.isActive(), true)
    assert.deepEqual(changes, [true, false, true])
  })
})
