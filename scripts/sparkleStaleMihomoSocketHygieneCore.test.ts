import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatStaleMihomoApiSocketAction,
  shouldRemoveStaleMihomoApiSocket,
} from './sparkleStaleMihomoSocketHygieneCore'

describe('sparkleStaleMihomoSocketHygieneCore', () => {
  it('removes socket when file exists but probe ECONNREFUSED', () => {
    const input = { exists: true, probeError: 'connect ECONNREFUSED /tmp/sparkle-mihomo-api.sock' }
    assert.equal(shouldRemoveStaleMihomoApiSocket(input), true)
    assert.match(formatStaleMihomoApiSocketAction('/tmp/sparkle-mihomo-api.sock', input) ?? '', /remove stale/)
  })

  it('keeps live socket when probe succeeds', () => {
    const input = { exists: true, probeError: null }
    assert.equal(shouldRemoveStaleMihomoApiSocket(input), false)
    assert.equal(formatStaleMihomoApiSocketAction('/tmp/sparkle-mihomo-api.sock', input), null)
  })

  it('ignores missing socket', () => {
    const input = { exists: false, probeError: null }
    assert.equal(shouldRemoveStaleMihomoApiSocket(input), false)
  })
})
