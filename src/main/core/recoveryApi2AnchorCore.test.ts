// [INPUT] recoveryApi2AnchorCore
// [OUTPUT] recoveryApi2AnchorCore.test
// [POS] BUG-2026-09-03-011 — sidecar false-success must fail without api2 anchor.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateSidecarExternalVerification,
  isVitalityConnectPathTrustworthy,
  MIN_CONNECT_PATH_DELAY_MS_FOR_VITALITY_TRUST,
  requiresRecoveryApi2Anchor,
} from './recoveryApi2AnchorCore'

describe('recoveryApi2AnchorCore', () => {
  it('requires api2 anchor on escalation paths', () => {
    assert.equal(requiresRecoveryApi2Anchor({ dialFailureClusterEscalation: true }), true)
    assert.equal(requiresRecoveryApi2Anchor({ emergencyStallEscalation: true }), true)
    assert.equal(requiresRecoveryApi2Anchor({ marathonGlobalByteDeath: true }), true)
    assert.equal(requiresRecoveryApi2Anchor({ proactiveHardRotate: true }), true)
    assert.equal(requiresRecoveryApi2Anchor({}), false)
  })

  it('connect_path_delay_ms=0 is untrustworthy', () => {
    assert.equal(isVitalityConnectPathTrustworthy(0), false)
    assert.equal(isVitalityConnectPathTrustworthy(49), false)
    assert.equal(isVitalityConnectPathTrustworthy(MIN_CONNECT_PATH_DELAY_MS_FOR_VITALITY_TRUST), true)
  })

  it('escalation path rejects executed sidecar when api2 fails', () => {
    const verdict = evaluateSidecarExternalVerification({
      sidecarOutcome: 'executed',
      connectPathDelayMs: 0,
      api2Ok: false,
      requireApi2Anchor: true,
    })
    assert.equal(verdict.verified, false)
    assert.equal(verdict.reason, 'api2_anchor_fail')
  })

  it('escalation path accepts executed sidecar when api2 fails but vitality connect path is trustworthy', () => {
    const verdict = evaluateSidecarExternalVerification({
      sidecarOutcome: 'executed',
      connectPathDelayMs: 439,
      api2Ok: false,
      requireApi2Anchor: true,
    })
    assert.equal(verdict.verified, true)
    assert.equal(verdict.reason, 'api2_anchor_fallback_trustworthy_vitality')
  })

  it('escalation path accepts executed sidecar when api2 ok', () => {
    const verdict = evaluateSidecarExternalVerification({
      sidecarOutcome: 'executed',
      connectPathDelayMs: 0,
      api2Ok: true,
      requireApi2Anchor: true,
    })
    assert.equal(verdict.verified, true)
    assert.equal(verdict.reason, 'api2_anchor_ok')
  })

  it('legacy path rejects delay=0 without api2', () => {
    const verdict = evaluateSidecarExternalVerification({
      sidecarOutcome: 'executed',
      connectPathDelayMs: 0,
      api2Ok: false,
      requireApi2Anchor: false,
    })
    assert.equal(verdict.verified, false)
    assert.equal(verdict.reason, 'vitality_untrustworthy_and_api2_fail')
  })
})
