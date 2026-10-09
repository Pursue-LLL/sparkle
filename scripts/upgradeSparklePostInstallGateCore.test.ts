import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countBug014RescueFailuresSinceLine,
  countPostCoreBootstrapFailuresSinceLine,
  hasApi2ProbePlaneSettledSinceLine,
  hasMacOs26HeadlessBootstrapCompleteSinceLine,
  isMacOsProductVersion26OrNewer,
} from './upgradeSparklePostInstallGateCore'

describe('upgradeSparklePostInstallGateCore', () => {
  it('counts only lines after install offset', () => {
    const log = [
      'old token_gap_nudge outcome=failed err={"message":"Resource not found"}',
      'install marker',
      'new connect_stream_keepalive_failed err={"message":"Resource not found"}',
      'ok token_gap_nudge outcome=executed',
    ].join('\n')
    assert.equal(countBug014RescueFailuresSinceLine(log, 2), 1)
    assert.equal(countBug014RescueFailuresSinceLine(log, 0), 2)
    assert.equal(countBug014RescueFailuresSinceLine(log, 99), 0)
  })

  it('ignores pre-install PostCoreBootstrap failed (R-27)', () => {
    const log = [
      '[PostCoreBootstrap]: failed: 核心控制器未初始化',
      'install marker',
      '[PostCoreBootstrap]: mihomo API ready',
      '[Api2ProbePlane]: ON — active transport probe',
    ].join('\n')
    assert.equal(countPostCoreBootstrapFailuresSinceLine(log, 1), 0)
    assert.equal(hasApi2ProbePlaneSettledSinceLine(log, 1), true)
  })

  it('treats macOS 26 GUI observability skip as probe plane settled', () => {
    const log = [
      '[Api2ProbePlane]: ON — before install',
      'install marker',
      '[PostCoreBootstrap]: mihomo API ready',
      '[PostCoreBootstrap]: macOS 26 GUI — observability stack skipped (Electron V8 SIGTRAP mitigation)',
    ].join('\n')
    assert.equal(hasApi2ProbePlaneSettledSinceLine(log, 1), true)
    assert.equal(hasApi2ProbePlaneSettledSinceLine(log.split('\n').slice(0, 3).join('\n'), 1), false)
  })

  it('detects post-install PostCoreBootstrap failed since offset', () => {
    const log = [
      'install marker',
      '[PostCoreBootstrap]: mihomo API ready',
      '[PostCoreBootstrap]: failed: core offline',
    ].join('\n')
    assert.equal(countPostCoreBootstrapFailuresSinceLine(log, 1), 1)
  })

  it('detects macOS 26 headless bootstrap complete since offset', () => {
    const log = [
      'install marker',
      '[MacOs26Headless]: bootstrap start (no BrowserWindow)',
      '[MacOs26Headless]: bootstrap complete api_ready=1',
    ].join('\n')
    assert.equal(hasMacOs26HeadlessBootstrapCompleteSinceLine(log, 1), true)
    assert.equal(hasMacOs26HeadlessBootstrapCompleteSinceLine(log, 3), false)
  })

  it('detects macOS 26 product version', () => {
    assert.equal(isMacOsProductVersion26OrNewer('26.5.2'), true)
    assert.equal(isMacOsProductVersion26OrNewer('15.6'), false)
  })
})
