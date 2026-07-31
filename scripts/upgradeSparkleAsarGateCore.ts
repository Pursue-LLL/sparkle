/** SSOT: post-build asar main bundle checks (upgrade-sparkle-local.sh + unit tests). */

export type SparkleMainAsarGateResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'missing_main'
        | 'stale_bundle'
        | 'missing_mark_core_ready_call'
        | 'missing_r34_frozen_prune'
        | 'regression_marathon_block_close'
        | 'missing_mihomo_close_connection'
        | 'missing_p28b_attempt_rate'
        | 'missing_r35_carrier_prune'
        | 'missing_r35_parent_sidecar'
    }

/** Vite minifies to `.markCoreReadyAtMs(` on chunk export — bare `markCoreReadyAtMs(` is BUG-2026-07-23-004. */
export function validateSparkleMainAsarBundle(mainSource: string): SparkleMainAsarGateResult {
  if (!mainSource.includes('appendAppLog')) {
    return { ok: false, reason: 'stale_bundle' }
  }
  if (mainSource.includes('.markCoreReadyAtMs(')) {
    // continue — markCoreReady present
  } else if (/\bmarkCoreReadyAtMs\s*\(/.test(mainSource)) {
    return { ok: false, reason: 'missing_mark_core_ready_call' }
  } else {
    return { ok: false, reason: 'missing_mark_core_ready_call' }
  }

  if (mainSource.includes('marathon_block_close_connection')) {
    return { ok: false, reason: 'regression_marathon_block_close' }
  }
  if (
    !mainSource.includes('frozen_surgical_prune') &&
    !mainSource.includes('close_frozen_connection')
  ) {
    return { ok: false, reason: 'missing_r34_frozen_prune' }
  }
  if (
    !mainSource.includes('mihomoCloseConnection') &&
    !mainSource.includes('.mihomoCloseConnection(')
  ) {
    return { ok: false, reason: 'missing_mihomo_close_connection' }
  }
  if (
    !mainSource.includes('attempt_rate_pct') &&
    !mainSource.includes('below_target_attempt')
  ) {
    return { ok: false, reason: 'missing_p28b_attempt_rate' }
  }
  if (!mainSource.includes('marathon_sse_carrier_frozen_prune')) {
    return { ok: false, reason: 'missing_r35_carrier_prune' }
  }
  if (
    !mainSource.includes('Hy2ParentSidecar') &&
    !mainSource.includes('proactive_parent_sidecar_dial')
  ) {
    return { ok: false, reason: 'missing_r35_parent_sidecar' }
  }

  return { ok: true }
}

export function assertSparkleMainAsarBundle(mainSource: string): void {
  const result = validateSparkleMainAsarBundle(mainSource)
  if (!result.ok) {
    const messages: Record<Exclude<SparkleMainAsarGateResult, { ok: true }>['reason'], string> = {
      missing_main: 'asar missing out/main/index.js',
      stale_bundle: 'asar main bundle looks stale or corrupt',
      missing_mark_core_ready_call: 'asar missing markCoreReadyAtMs call — PostCoreBootstrap will fail',
      missing_r34_frozen_prune: 'asar missing R-34 frozen_surgical_prune — stall recovery will block close',
      regression_marathon_block_close: 'asar still contains marathon_block_close_connection regression',
      missing_mihomo_close_connection: 'asar missing mihomoCloseConnection — frozen prune close will fail at runtime',
      missing_p28b_attempt_rate: 'asar missing P28b attempt_rate_pct — G9 soak SLO metrics will not emit',
      missing_r35_carrier_prune: 'asar missing R-35 marathon_sse_carrier_frozen_prune',
      missing_r35_parent_sidecar: 'asar missing R-35 Hy2ParentSidecar proactive dial',
    }
    throw new Error(messages[result.reason])
  }
}
