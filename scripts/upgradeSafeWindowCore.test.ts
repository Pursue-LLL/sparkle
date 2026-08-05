import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateRemedialG9Upgrade,
  isUpgradeBreakGlassEnabled,
  isUpgradeSafeWindowIdle,
  shouldRunPostInstallRecoveryRound,
} from './upgradeSafeWindowCore.ts'

describe('upgradeSafeWindowCore', () => {
  it('detects break-glass env', () => {
    assert.equal(isUpgradeBreakGlassEnabled('1', '0'), true)
    assert.equal(isUpgradeBreakGlassEnabled('0', '1'), true)
    assert.equal(isUpgradeBreakGlassEnabled('0', '0'), false)
  })

  it('requires idle cursor_conn and no quiesce', () => {
    assert.equal(
      isUpgradeSafeWindowIdle({
        cursorConnectionCount: 0,
        quiesceActive: false,
        blockColdRestart: false,
        recentActiveLifecycleStreamCount: 0,
        observationAvailable: true,
      }),
      true,
    )
    assert.equal(
      isUpgradeSafeWindowIdle({
        cursorConnectionCount: 12,
        quiesceActive: false,
        blockColdRestart: false,
        recentActiveLifecycleStreamCount: 0,
        observationAvailable: true,
      }),
      false,
    )
  })

  it('allows remedial G9 for active control-plane incident', () => {
    const result = evaluateRemedialG9Upgrade({
      gateBlocked: true,
      gateReason: 'attempt_rate_pct=2.0 below target 90',
      installedVersion: '1.30.1',
      targetVersion: '1.30.5',
      registry: { active: ['BUG-2026-08-05-001'] },
    })
    assert.equal(result.allowRemedial, true)
    assert.match(result.auditReason, /control_plane_hotfix/)
  })

  it('runs post-install recovery when bootstrap not ready', () => {
    assert.equal(
      shouldRunPostInstallRecoveryRound({
        mihomoApiReady: false,
        api2ProbePlaneOn: false,
        postCoreBootstrapFailed: true,
        roundIndex: 0,
        maxRounds: 2,
      }),
      true,
    )
    assert.equal(
      shouldRunPostInstallRecoveryRound({
        mihomoApiReady: true,
        api2ProbePlaneOn: true,
        postCoreBootstrapFailed: false,
        roundIndex: 0,
        maxRounds: 2,
      }),
      false,
    )
  })
})
