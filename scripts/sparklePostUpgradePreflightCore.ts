/** Post-upgrade preflight gates — version, R-34 bundle markers, hygiene, close API smoke input. */

export interface SparklePostUpgradePreflightInput {
  installedVersion: string
  expectedVersion: string
  mainAsarSource: string
  appLogTail: string
  guardPatchAppliedJson: string
  sparkleConfigYaml: string
  mihomoCloseSmokeOk: boolean
}

export interface SparklePostUpgradePreflightCheck {
  id: string
  ok: boolean
  detail: string
}

export interface SparklePostUpgradePreflightResult {
  ok: boolean
  checks: SparklePostUpgradePreflightCheck[]
}

export function evaluateSparklePostUpgradePreflight(
  input: SparklePostUpgradePreflightInput,
): SparklePostUpgradePreflightResult {
  const checks: SparklePostUpgradePreflightCheck[] = []

  checks.push({
    id: 'version',
    ok: input.installedVersion === input.expectedVersion,
    detail: `installed=${input.installedVersion} expected=${input.expectedVersion}`,
  })

  const hasFrozenPrune =
    input.mainAsarSource.includes('frozen_surgical_prune') ||
    input.mainAsarSource.includes('close_frozen_connection')
  checks.push({
    id: 'r34_frozen_prune',
    ok: hasFrozenPrune && !input.mainAsarSource.includes('marathon_block_close_connection'),
    detail: hasFrozenPrune ? 'R-34 markers present' : 'missing R-34 markers',
  })

  checks.push({
    id: 'mihomo_close_api',
    ok:
      (input.mainAsarSource.includes('mihomoCloseConnection') ||
        input.mainAsarSource.includes('.mihomoCloseConnection(')) &&
      input.mihomoCloseSmokeOk,
    detail: input.mihomoCloseSmokeOk ? 'close API smoke ok' : 'close API smoke failed',
  })

  const hygieneOff =
    /cursorConnectionHygieneEnabled:\s*false/i.test(input.sparkleConfigYaml) &&
    /autoCloseConnection:\s*false/i.test(input.sparkleConfigYaml)
  checks.push({
    id: 'connection_hygiene_off',
    ok: hygieneOff,
    detail: hygieneOff ? 'hygiene disabled' : 'hygiene must stay disabled',
  })

  const guardObserveOnly =
    /observe[-_]?only/i.test(input.guardPatchAppliedJson) ||
    /"phase"\s*:\s*"detect_only"/i.test(input.guardPatchAppliedJson)
  checks.push({
    id: 'guard_observe_only',
    ok: guardObserveOnly || input.guardPatchAppliedJson.trim().length === 0,
    detail: guardObserveOnly ? 'guard observe-only/detect_only' : 'guard patch state unknown',
  })

  const maxStepsRateReady =
    input.mainAsarSource.includes('MaxStepsRate') ||
    input.mainAsarSource.includes('maxStepsRateObserver') ||
    /\[MaxStepsRate\]/.test(input.appLogTail)
  checks.push({
    id: 'max_steps_rate',
    ok: maxStepsRateReady,
    detail: maxStepsRateReady ? 'MaxStepsRate wired' : 'MaxStepsRate missing',
  })

  const p28bAttemptReady =
    input.mainAsarSource.includes('attempt_rate_pct') ||
    input.mainAsarSource.includes('below_target_attempt') ||
    /attempt_rate_pct=/.test(input.appLogTail)
  checks.push({
    id: 'p28b_attempt_rate',
    ok: p28bAttemptReady,
    detail: p28bAttemptReady ? 'P28b attempt SLO wired' : 'P28b attempt_rate_pct missing',
  })

  const r35Ready =
    input.mainAsarSource.includes('marathon_sse_carrier_frozen_prune') &&
    (input.mainAsarSource.includes('Hy2ParentSidecar') ||
      input.mainAsarSource.includes('proactive_parent_sidecar_dial') ||
      input.mainAsarSource.includes('hy2_parent_sidecar'))
  checks.push({
    id: 'r35_carrier_sidecar',
    ok: r35Ready,
    detail: r35Ready ? 'R-35 carrier prune + parent sidecar wired' : 'missing R-35 markers',
  })

  const closeFnRegression = /mihomoCloseConnection is not a function/i.test(input.appLogTail)
  checks.push({
    id: 'no_close_fn_regression',
    ok: !closeFnRegression,
    detail: closeFnRegression ? 'close fn regression detected' : 'no close fn regression',
  })

  return {
    ok: checks.every((check) => check.ok),
    checks,
  }
}

export function formatSparklePostUpgradePreflightReport(result: SparklePostUpgradePreflightResult): string {
  const lines = result.checks.map((check) => `${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`)
  lines.unshift(result.ok ? '[Preflight1280] ALL PASS' : '[Preflight1280] FAIL')
  return lines.join('\n')
}
