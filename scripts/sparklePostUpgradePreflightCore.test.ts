import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateSparklePostUpgradePreflight,
  formatSparklePostUpgradePreflightReport,
} from './sparklePostUpgradePreflightCore'

describe('sparklePostUpgradePreflightCore', () => {
  const goodAsar =
    'frozen_surgical_prune close_frozen_connection marathon_sse_carrier_frozen_prune Hy2ParentSidecar proactive_parent_sidecar_dial mihomoCloseConnection maxStepsRateObserver markCoreReadyAtMs appendAppLog attempt_rate_pct below_target_attempt'
  const goodConfig = 'cursorConnectionHygieneEnabled: false\nautoCloseConnection: false'
  const goodGuard = '{"phase":"detect_only","observe-only":true}'

  it('passes when all gates satisfied', () => {
    const result = evaluateSparklePostUpgradePreflight({
      installedVersion: '1.28.0',
      expectedVersion: '1.28.0',
      mainAsarSource: goodAsar,
      appLogTail: '[MaxStepsRate]: window=rolling100 rate_pct=90.0',
      guardPatchAppliedJson: goodGuard,
      sparkleConfigYaml: goodConfig,
      mihomoCloseSmokeOk: true,
    })
    assert.equal(result.ok, true)
    assert.match(formatSparklePostUpgradePreflightReport(result), /ALL PASS/)
  })

  it('fails on marathon_block_close regression', () => {
    const result = evaluateSparklePostUpgradePreflight({
      installedVersion: '1.28.0',
      expectedVersion: '1.28.0',
      mainAsarSource: `${goodAsar} marathon_block_close_connection`,
      appLogTail: '',
      guardPatchAppliedJson: goodGuard,
      sparkleConfigYaml: goodConfig,
      mihomoCloseSmokeOk: true,
    })
    assert.equal(result.ok, false)
    const r34 = result.checks.find((check) => check.id === 'r34_frozen_prune')
    assert.equal(r34?.ok, false)
  })
})
