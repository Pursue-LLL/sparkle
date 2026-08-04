import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateMarathonProtocolColdStartGate,
  evaluateMarathonProtocolSwitchDecision,
  formatMarathonProtocolColdStartGateLogLine,
  formatMarathonProtocolLateStartLogLine,
  formatMarathonProtocolSwitchBlockedLogLine,
  resolveShouldAutoUpgradeSuboptimalIdleTls,
} from './marathonProtocolContractCore'

describe('marathonProtocolContractCore R-30/R-31', () => {
  it('does not require cold-start gate for HY2 while idle — marathon SSOT optimal leaf', () => {
    const gate = evaluateMarathonProtocolColdStartGate({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      activeNode: 'JP-VPS-HY2',
    })
    assert.equal(gate.required, false)
    assert.equal(gate.riskClass, 'none')
  })

  it('requires cold-start gate for TUIC and Reality', () => {
    for (const node of ['JP-VPS-TUIC', 'KR-VPS-Reality'] as const) {
      const gate = evaluateMarathonProtocolColdStartGate({
        cursorConnectionCount: 0,
        marathonTruthActive: false,
        activeNode: node,
      })
      assert.equal(gate.required, true, node)
    }
  })

  it('requires cold-start gate for persisted TLS canary — recover to HY2', () => {
    const gate = evaluateMarathonProtocolColdStartGate({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      activeNode: 'JP-VPS-TLS',
    })
    assert.equal(gate.required, true)
    assert.equal(gate.riskClass, 'suboptimal_leaf')
    assert.equal(gate.recommendedNode, 'JP-VPS-HY2')
    assert.match(formatMarathonProtocolColdStartGateLogLine(gate), /gate_required/)
  })

  it('does not require gate when cursor connections are active', () => {
    const gate = evaluateMarathonProtocolColdStartGate({
      cursorConnectionCount: 12,
      marathonTruthActive: false,
      activeNode: 'JP-VPS-HY2',
    })
    assert.equal(gate.required, false)
  })

  it('does not require gate when marathon truth is already active', () => {
    const gate = evaluateMarathonProtocolColdStartGate({
      cursorConnectionCount: 0,
      marathonTruthActive: true,
      activeNode: 'JP-VPS-HY2',
    })
    assert.equal(gate.required, false)
  })

  it('skips cold-start gate when operator manually selected suboptimal leaf', () => {
    const gate = evaluateMarathonProtocolColdStartGate({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      activeNode: 'JP-VPS-HY2',
      manualSelectionNode: 'JP-VPS-HY2',
    })
    assert.equal(gate.required, false)
    assert.equal(gate.riskClass, 'none')
  })

  it('blocks auto leaf switches during marathon truth active', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 18,
      marathonTruthActive: true,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TLS',
      source: 'auto',
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'blocked_marathon_active')
  })

  it('blocks auto mid-session switches when cursor_conn > 0', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 3,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TLS',
      source: 'auto',
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'blocked_mid_session')
  })

  it('R-31 allows manual TLS to HY2 during marathon truth active', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 18,
      marathonTruthActive: true,
      fromNode: 'JP-VPS-TLS',
      toNode: 'JP-VPS-HY2',
      source: 'manual',
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.reason, 'allowed_manual_operator')
  })

  it('1.30.1 blocks manual HY2 to TLS — marathon HY2-only SSOT', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 3,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TLS',
      source: 'manual',
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'blocked_marathon_hy2_only_tls_denied')
  })

  it('R-31 still blocks manual suboptimal lateral switches during session', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 20,
      marathonTruthActive: true,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TUIC',
      source: 'manual',
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'blocked_suboptimal_lateral')
  })

  it('1.30.1 blocks protocol_contract HY2 to TLS even when MTIC invariants green', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TLS',
      source: 'protocol_contract',
      mutationSnapshot: {
        cursorConnectionCount: 0,
        marathonTruthActive: false,
        hy2ParentChainAgeMs: 0,
        staleRidCount: 0,
        postCoreRestartQuarantineRemainingMs: 0,
      },
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'blocked_marathon_hy2_only_tls_denied')
  })

  it('1.30.1 HY2-only deny precedes MTIC replay 2026-08-04 14:50 class', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TLS',
      source: 'protocol_contract',
      mutationSnapshot: {
        cursorConnectionCount: 0,
        marathonTruthActive: false,
        hy2ParentChainAgeMs: 576_042,
        staleRidCount: 3,
        postCoreRestartQuarantineRemainingMs: 554_265,
      },
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'blocked_marathon_hy2_only_tls_denied')
  })

  it('allows protocol_contract TLS to HY2 downgrade when idle', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-TLS',
      toNode: 'JP-VPS-HY2',
      source: 'protocol_contract',
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.reason, 'protocol_downgrade_from_tls')
  })

  it('allows trusted idle lateral switch', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-TLS',
      toNode: 'Sparkle-自动-新加坡',
      source: 'manual',
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.reason, 'allowed_trusted_idle')
  })

  it('allows auto/bootstrap TLS to HY2 downgrade while idle', () => {
    for (const source of ['auto', 'bootstrap'] as const) {
      const decision = evaluateMarathonProtocolSwitchDecision({
        cursorConnectionCount: 0,
        marathonTruthActive: false,
        fromNode: 'JP-VPS-TLS',
        toNode: 'JP-VPS-HY2',
        source,
      })
      assert.equal(decision.allowed, true, source)
      assert.equal(decision.reason, 'protocol_downgrade_from_tls')
    }
  })

  it('blocks suboptimal lateral switches while idle', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TUIC',
      source: 'manual',
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'blocked_suboptimal_lateral')
  })

  it('allows manual suboptimal selection while idle for power users', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-TLS',
      toNode: 'JP-VPS-HY2',
      source: 'manual',
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.reason, 'allowed_manual_suboptimal_idle')
  })

  it('formatMarathonProtocolSwitchBlockedLogLine includes marathon_truth_active', () => {
    const line = formatMarathonProtocolSwitchBlockedLogLine({
      group: '🎯 Cursor 专用',
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TLS',
      reason: 'blocked_marathon_active',
      cursorConnectionCount: 20,
      marathonTruthActive: true,
      source: 'manual',
    })
    assert.match(line, /switch_blocked/)
    assert.match(line, /marathon_truth_active=1/)
  })

  it('formatMarathonProtocolLateStartLogLine marks gate_missed', () => {
    const line = formatMarathonProtocolLateStartLogLine({
      activeNode: 'JP-VPS-HY2',
      cursorConnectionCount: 4,
    })
    assert.match(line, /marathon_started_on_suboptimal_leaf/)
    assert.match(line, /gate_missed=1/)
  })

  it('1.30.1 never auto TLS — resolveShouldAutoUpgradeSuboptimalIdleTls always false', () => {
    assert.equal(
      resolveShouldAutoUpgradeSuboptimalIdleTls({
        cursorConnectionCount: 0,
        activeNode: 'JP-VPS-HY2',
      }),
      false,
    )
    assert.equal(
      resolveShouldAutoUpgradeSuboptimalIdleTls({
        cursorConnectionCount: 12,
        activeNode: 'JP-VPS-HY2',
      }),
      false,
    )
    assert.equal(
      resolveShouldAutoUpgradeSuboptimalIdleTls({
        cursorConnectionCount: 0,
        activeNode: 'JP-VPS-TLS',
      }),
      false,
    )
  })
})
