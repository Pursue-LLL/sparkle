import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countBug014RescueFailuresSinceLine,
  countPostCoreBootstrapFailuresSinceLine,
  hasApi2ProbePlaneOnSinceLine,
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
    assert.equal(hasApi2ProbePlaneOnSinceLine(log, 1), true)
  })

  it('detects post-install PostCoreBootstrap failed since offset', () => {
    const log = [
      'install marker',
      '[PostCoreBootstrap]: mihomo API ready',
      '[PostCoreBootstrap]: failed: core offline',
    ].join('\n')
    assert.equal(countPostCoreBootstrapFailuresSinceLine(log, 1), 1)
  })
})
