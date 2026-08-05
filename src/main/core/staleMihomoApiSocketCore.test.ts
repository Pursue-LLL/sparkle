import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isStaleMihomoApiSocketProbeError,
  resolveCoreStartFootprintDecision,
  shouldRemoveStaleMihomoApiSocket,
} from './staleMihomoApiSocketCore'

describe('staleMihomoApiSocketCore', () => {
  it('detects ECONNREFUSED probe as stale', () => {
    assert.equal(isStaleMihomoApiSocketProbeError('connect ECONNREFUSED /tmp/s.sock'), true)
    assert.equal(shouldRemoveStaleMihomoApiSocket({ exists: true, probeError: 'ECONNREFUSED' }), true)
  })

  it('blocks start when live socket responds', () => {
    const decision = resolveCoreStartFootprintDecision({
      hasChildProcess: false,
      corePidExists: false,
      socketExists: true,
      probeError: null,
      staleSocketRemoved: false,
    })
    assert.deepEqual(decision, { blockStart: true, reason: 'protected_existing_core' })
  })

  it('allows start-only after stale socket removed', () => {
    const decision = resolveCoreStartFootprintDecision({
      hasChildProcess: false,
      corePidExists: false,
      socketExists: true,
      probeError: 'connect ECONNREFUSED /tmp/sparkle-mihomo-api.sock',
      staleSocketRemoved: true,
    })
    assert.deepEqual(decision, { blockStart: false, reason: 'stale_socket_removed_start_only' })
  })

  it('blocks when stale socket cannot be removed', () => {
    const decision = resolveCoreStartFootprintDecision({
      hasChildProcess: false,
      corePidExists: false,
      socketExists: true,
      probeError: 'connect ECONNREFUSED /tmp/sparkle-mihomo-api.sock',
      staleSocketRemoved: false,
    })
    assert.deepEqual(decision, { blockStart: true, reason: 'stale_socket_remove_failed' })
  })
})
