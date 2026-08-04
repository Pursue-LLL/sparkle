import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateTransportMutationAllowed,
  formatTransportMutationGateLogLine,
  resolveHy2ParentChainAgeMs,
  type TransportMutationSnapshot,
} from './transportMutationGateCore'

const IDLE_SNAPSHOT: TransportMutationSnapshot = {
  cursorConnectionCount: 0,
  marathonTruthActive: false,
  hy2ParentChainAgeMs: 0,
  staleRidCount: 0,
  postCoreRestartQuarantineRemainingMs: 0,
}

/** 2026-08-04 14:50:09 CST protocol_upgrade incident replay. */
const REPLAY_1450_SNAPSHOT: TransportMutationSnapshot = {
  cursorConnectionCount: 0,
  marathonTruthActive: false,
  hy2ParentChainAgeMs: 576_042,
  staleRidCount: 3,
  postCoreRestartQuarantineRemainingMs: 554_265,
}

describe('transportMutationGateCore MTIC-v2', () => {
  it('allows protocol_upgrade when all invariants green', () => {
    const decision = evaluateTransportMutationAllowed('protocol_upgrade', IDLE_SNAPSHOT)
    assert.equal(decision.allowed, true)
    assert.equal(decision.reason, 'allowed')
  })

  it('replay 2026-08-04 14:50:09 denies protocol_upgrade (hy2 chain + quarantine + stale)', () => {
    const decision = evaluateTransportMutationAllowed('protocol_upgrade', REPLAY_1450_SNAPSHOT)
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'deny_quarantine_active')
  })

  it('denies protocol_upgrade when hy2 parent chain alive', () => {
    const decision = evaluateTransportMutationAllowed('protocol_upgrade', {
      ...IDLE_SNAPSHOT,
      hy2ParentChainAgeMs: 950_567,
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'deny_hy2_parent_chain_alive')
  })

  it('denies protocol_upgrade when stale rids present', () => {
    const decision = evaluateTransportMutationAllowed('protocol_upgrade', {
      ...IDLE_SNAPSHOT,
      staleRidCount: 5,
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'deny_stale_rids_present')
  })

  it('denies protocol_upgrade during post-core quarantine', () => {
    const decision = evaluateTransportMutationAllowed('protocol_upgrade', {
      ...IDLE_SNAPSHOT,
      postCoreRestartQuarantineRemainingMs: 120_000,
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'deny_quarantine_active')
  })

  it('denies protocol_upgrade when cursor_conn active', () => {
    const decision = evaluateTransportMutationAllowed('protocol_upgrade', {
      ...IDLE_SNAPSHOT,
      cursorConnectionCount: 18,
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'deny_cursor_conn_active')
  })

  it('denies protocol_upgrade when marathon truth active', () => {
    const decision = evaluateTransportMutationAllowed('protocol_upgrade', {
      ...IDLE_SNAPSHOT,
      marathonTruthActive: true,
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'deny_marathon_truth_active')
  })

  it('denies close_connection on critical host without server EOF proof', () => {
    const decision = evaluateTransportMutationAllowed('close_connection', {
      ...IDLE_SNAPSHOT,
      hostIsCritical: true,
      serverEofProof: false,
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'deny_critical_host_close')
  })

  it('allows close_connection on critical host with server EOF proof', () => {
    const decision = evaluateTransportMutationAllowed('close_connection', {
      ...IDLE_SNAPSHOT,
      hostIsCritical: true,
      serverEofProof: true,
    })
    assert.equal(decision.allowed, true)
  })

  it('node_switch follows same invariants as protocol_upgrade', () => {
    const decision = evaluateTransportMutationAllowed('node_switch', REPLAY_1450_SNAPSHOT)
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'deny_quarantine_active')
  })

  it('resolveHy2ParentChainAgeMs prefers persisted birth ms', () => {
    const nowMs = 1_785_826_659_999
    const birthMs = 1_785_825_659_999
    const age = resolveHy2ParentChainAgeMs({
      nowMs,
      hy2ParentChainBirthMs: birthMs,
      httpParentChainAgeMs: 100,
      outboundHy2SessionAgeMs: 200,
    })
    assert.equal(age, 1_000_000)
  })

  it('formatTransportMutationGateLogLine includes mtic_v2 marker fields', () => {
    const line = formatTransportMutationGateLogLine({
      mutation: 'protocol_upgrade',
      decision: { allowed: false, reason: 'deny_hy2_parent_chain_alive' },
      cursorConnectionCount: 0,
      hy2ParentChainAgeMs: 576_042,
      staleRidCount: 3,
      quarantineRemainingMs: 554_265,
    })
    assert.match(line, /\[TransportMutationGate\]/)
    assert.match(line, /hy2_parent_chain_age_ms=576042/)
    assert.match(line, /outcome=denied/)
  })
})

describe('transportMutationGateCore 12-state matrix', () => {
  const flags = [
    { quarantine: 0, chain: 0, stale: 0, conn: 0, truth: false, expect: true },
    { quarantine: 1, chain: 0, stale: 0, conn: 0, truth: false, expect: false },
    { quarantine: 0, chain: 1, stale: 0, conn: 0, truth: false, expect: false },
    { quarantine: 0, chain: 0, stale: 1, conn: 0, truth: false, expect: false },
    { quarantine: 0, chain: 0, stale: 0, conn: 1, truth: false, expect: false },
    { quarantine: 0, chain: 0, stale: 0, conn: 0, truth: true, expect: false },
    { quarantine: 1, chain: 1, stale: 1, conn: 18, truth: true, expect: false },
  ] as const

  for (const [index, row] of flags.entries()) {
    it(`matrix row ${index + 1} allow=${row.expect}`, () => {
      const decision = evaluateTransportMutationAllowed('protocol_upgrade', {
        cursorConnectionCount: row.conn,
        marathonTruthActive: row.truth,
        hy2ParentChainAgeMs: row.chain > 0 ? 60_000 : 0,
        staleRidCount: row.stale,
        postCoreRestartQuarantineRemainingMs: row.quarantine > 0 ? 60_000 : 0,
      })
      assert.equal(decision.allowed, row.expect)
    })
  }
})
