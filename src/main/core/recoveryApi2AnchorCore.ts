// [INPUT] sidecar/vitality outcomes · api2 probe result
// [OUTPUT] recovery external-anchor verification SSOT (BUG-2026-09-03-011/012)
// [POS] Sidecar/vitality internal green is insufficient — api2 via Cursor dedicated leaf is the anchor.

/** How recovery api2 anchor was probed — mixed-port fallback is legacy/untrusted. */
export type RecoveryApi2AnchorProbeVia = 'cursor_dedicated_mihomo' | 'mixed_port_fallback'

/** connect_path_delay_ms=0 is a known false-positive when HY2 parent is stale-dead. */
export const MIN_CONNECT_PATH_DELAY_MS_FOR_VITALITY_TRUST = 50

export function requiresRecoveryApi2Anchor(input: {
  dialFailureClusterEscalation?: boolean
  emergencyStallEscalation?: boolean
  marathonGlobalByteDeath?: boolean
  proactiveHardRotate?: boolean
}): boolean {
  return (
    input.dialFailureClusterEscalation === true ||
    input.emergencyStallEscalation === true ||
    input.marathonGlobalByteDeath === true ||
    input.proactiveHardRotate === true
  )
}

export function isVitalityConnectPathTrustworthy(
  connectPathDelayMs: number | undefined,
): boolean {
  return (
    typeof connectPathDelayMs === 'number' &&
    connectPathDelayMs >= MIN_CONNECT_PATH_DELAY_MS_FOR_VITALITY_TRUST
  )
}

export function evaluateSidecarExternalVerification(input: {
  sidecarOutcome: 'executed' | 'skipped' | 'failed'
  connectPathDelayMs?: number
  api2Ok: boolean
  requireApi2Anchor: boolean
}): { verified: boolean; reason: string } {
  if (input.sidecarOutcome !== 'executed') {
    return { verified: false, reason: 'sidecar_not_executed' }
  }
  if (!input.requireApi2Anchor) {
    if (input.api2Ok || isVitalityConnectPathTrustworthy(input.connectPathDelayMs)) {
      return { verified: true, reason: 'legacy_vitality_or_api2_ok' }
    }
    return { verified: false, reason: 'vitality_untrustworthy_and_api2_fail' }
  }
  if (!input.api2Ok) {
    if (isVitalityConnectPathTrustworthy(input.connectPathDelayMs)) {
      return { verified: true, reason: 'api2_anchor_fallback_trustworthy_vitality' }
    }
    return { verified: false, reason: 'api2_anchor_fail' }
  }
  return { verified: true, reason: 'api2_anchor_ok' }
}
