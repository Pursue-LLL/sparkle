import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyTunStartupLogLine,
  createTunStartupGuardState,
  isTunAdapterListeningLog,
  isTunPermissionError,
  shouldRecoverTunPermission
} from './tunStartupGuardCore'

describe('tunStartupGuardCore', () => {
  it('detects tun adapter listening log', () => {
    assert.equal(
      isTunAdapterListeningLog(
        '[TUN] Tun adapter listening at: utun4([198.18.0.1/30],[]), mtu: 1400'
      ),
      true
    )
  })

  it('detects tun permission error log', () => {
    assert.equal(
      isTunPermissionError(
        'Start TUN listening error: configure tun interface: operation not permitted'
      ),
      true
    )
  })

  it('marks permission error and clears adapter flag', () => {
    let state = createTunStartupGuardState()
    state = applyTunStartupLogLine(
      state,
      '[TUN] Tun adapter listening at: utun4([198.18.0.1/30],[]), mtu: 1400'
    )
    assert.equal(state.adapterListening, true)

    state = applyTunStartupLogLine(
      state,
      'Start TUN listening error: configure tun interface: operation not permitted'
    )
    assert.equal(state.permissionErrorSeen, true)
    assert.equal(state.adapterListening, false)
  })

  it('requires recovery when tun enabled without setuid', () => {
    const state = createTunStartupGuardState()
    assert.equal(shouldRecoverTunPermission(true, false, state, 2), true)
  })

  it('skips recovery when adapter is listening', () => {
    const state = {
      ...createTunStartupGuardState(),
      adapterListening: true
    }
    assert.equal(shouldRecoverTunPermission(true, true, state, 2), false)
  })
})
