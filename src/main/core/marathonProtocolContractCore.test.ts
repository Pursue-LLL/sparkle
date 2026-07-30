import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateMarathonProtocolColdStartGate,
  evaluateMarathonProtocolSwitchDecision,
  formatMarathonProtocolColdStartGateLogLine,
  formatMarathonProtocolSwitchBlockedLogLine,
} from './marathonProtocolContractCore'

describe('marathonProtocolContractCore R-30', () => {
  it('requires cold-start gate for HY2 while idle', () => {
    const gate = evaluateMarathonProtocolColdStartGate({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      activeNode: 'JP-VPS-HY2',
    })
    assert.equal(gate.required, true)
    assert.equal(gate.riskClass, 'suboptimal_leaf')
    assert.equal(gate.recommendedNode, 'JP-VPS-TLS')
    assert.match(formatMarathonProtocolColdStartGateLogLine(gate), /gate_required/)
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

  it('does not require gate for trusted TLS leaf', () => {
    const gate = evaluateMarathonProtocolColdStartGate({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      activeNode: 'JP-VPS-TLS',
    })
    assert.equal(gate.required, false)
    assert.equal(gate.riskClass, 'none')
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

  it('blocks all cursor leaf switches during marathon truth active', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 18,
      marathonTruthActive: true,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TLS',
      source: 'manual',
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'blocked_marathon_active')
  })

  it('blocks mid-session switches when cursor_conn > 0', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 3,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TLS',
      source: 'manual',
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'blocked_mid_session')
  })

  it('allows cold-start protocol upgrade HY2 to TLS', () => {
    const decision = evaluateMarathonProtocolSwitchDecision({
      cursorConnectionCount: 0,
      marathonTruthActive: false,
      fromNode: 'JP-VPS-HY2',
      toNode: 'JP-VPS-TLS',
      source: 'protocol_contract',
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.reason, 'protocol_upgrade_to_tls')
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

  it('blocks auto/bootstrap switches to suboptimal leaves', () => {
    for (const source of ['auto', 'bootstrap'] as const) {
      const decision = evaluateMarathonProtocolSwitchDecision({
        cursorConnectionCount: 0,
        marathonTruthActive: false,
        fromNode: 'JP-VPS-TLS',
        toNode: 'JP-VPS-HY2',
        source,
      })
      assert.equal(decision.allowed, false, source)
      assert.equal(decision.reason, 'blocked_auto_suboptimal')
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
})
