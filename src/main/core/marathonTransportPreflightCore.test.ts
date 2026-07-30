import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatMarathonTransportPreflightLogLine,
  resolveMarathonTransportPreflight,
  resolveMarathonTransportProtocolClass,
} from './marathonTransportPreflightCore'

describe('marathonTransportPreflightCore R-19', () => {
  it('classifies TLS and QUIC marathon leaves', () => {
    assert.equal(resolveMarathonTransportProtocolClass('JP-VPS-TLS'), 'tcp_tls')
    assert.equal(resolveMarathonTransportProtocolClass('JP-VPS-TUIC'), 'quic_inbound')
    assert.equal(resolveMarathonTransportProtocolClass('JP-VPS-HY2'), 'quic_inbound')
    assert.equal(resolveMarathonTransportProtocolClass('Sparkle-自动-新加坡'), 'other')
  })

  it('marks QUIC leaves as split_brain_class risk', () => {
    const result = resolveMarathonTransportPreflight({
      activeNode: 'JP-VPS-TUIC',
      cursorConnectionCount: 22,
    })
    assert.equal(result.quicLeafActive, true)
    assert.equal(result.splitBrainRiskClass, 'split_brain_class')
    assert.match(formatMarathonTransportPreflightLogLine(result), /outcome=quic_leaf_active/)
    assert.match(formatMarathonTransportPreflightLogLine(result), /observe_only=true/)
  })

  it('marks trusted TLS leaf as low risk', () => {
    const result = resolveMarathonTransportPreflight({
      activeNode: 'JP-VPS-TLS',
      cursorConnectionCount: 18,
    })
    assert.equal(result.quicLeafActive, false)
    assert.equal(result.splitBrainRiskClass, 'none')
    assert.match(formatMarathonTransportPreflightLogLine(result), /outcome=tcp_or_trusted_leaf/)
  })
})
