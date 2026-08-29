import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  resolveElevatedStartCoreMutationIntent,
  resolveServiceStartCoreMutationIntent,
  resolveStartCoreMutationFromFootprint,
} from './startCoreMutationGuardCore'

describe('startCoreMutationGuardCore Layer-0', () => {
  it('treats elevated child as mutation', () => {
    const intent = resolveElevatedStartCoreMutationIntent({
      hasChildProcess: true,
      footprint: { blockStart: false, reason: 'no_existing_core_footprint' },
    })
    assert.equal(intent.wouldMutate, true)
    assert.equal(intent.reason, 'elevated_child_running')
  })

  it('treats protected_existing_core footprint as mutation', () => {
    const intent = resolveStartCoreMutationFromFootprint({
      blockStart: true,
      reason: 'protected_existing_core',
    })
    assert.equal(intent.wouldMutate, true)
    assert.equal(intent.reason, 'protected_existing_core_footprint')
  })

  it('allows stale socket removed start-only without mutation flag', () => {
    const intent = resolveStartCoreMutationFromFootprint({
      blockStart: false,
      reason: 'stale_socket_removed_start_only',
    })
    assert.equal(intent.wouldMutate, false)
    assert.equal(intent.reason, 'no_live_core')
  })

  it('treats service core restart as mutation', () => {
    const intent = resolveServiceStartCoreMutationIntent('restart')
    assert.equal(intent.wouldMutate, true)
    assert.equal(intent.reason, 'service_core_restart')
  })

  it('allows service core keep/start without mutation flag', () => {
    assert.equal(resolveServiceStartCoreMutationIntent('keep').wouldMutate, false)
    assert.equal(resolveServiceStartCoreMutationIntent('start').wouldMutate, false)
  })
})
