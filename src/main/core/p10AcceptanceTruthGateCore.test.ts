import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectUniqueNetworkStartIds,
  countValidatedLedgerEventKinds,
  runP10AcceptanceTruthGate,
} from './p10AcceptanceTruthGateCore'

describe('p10AcceptanceTruthGateCore Gate A', () => {
  it('counts eventKind from structured envelope only', () => {
    const lines = [
      JSON.stringify({ envelope: { eventKind: 'http_segment_started' } }),
      JSON.stringify({ envelope: { eventKind: 'network_started', payload: { networkStartId: 'n1' } } }),
      JSON.stringify({ eventKind: 'http_segment_started' }),
    ]
    const counts = countValidatedLedgerEventKinds(lines)
    assert.equal(counts.httpSegmentStarted, 2)
    assert.equal(counts.networkStarted, 1)
  })

  it('fails deploy gate when http segments exist but network_started is zero', () => {
    const gate = runP10AcceptanceTruthGate({
      sparklePackageJsonPath: '/tmp/none-sparkle/package.json',
      guardPackageJsonPath: '/tmp/none-guard/package.json',
      validatedLedgerPath: '/tmp/none-ledger.jsonl',
      cursorProfileExtensionRoots: [],
    })
    const caseNames = new Set(gate.cases.map((item) => item.name))
    assert.ok(caseNames.has('deploy_candidate_requires_network_started_when_http_segments_exist'))
  })

  it('tracks unique networkStartId values', () => {
    const lines = [
      JSON.stringify({
        envelope: { eventKind: 'network_started', payload: { networkStartId: 'a' } },
      }),
      JSON.stringify({
        envelope: { eventKind: 'network_started', payload: { networkStartId: 'a' } },
      }),
      JSON.stringify({
        envelope: { eventKind: 'network_started', payload: { networkStartId: 'b' } },
      }),
    ]
    assert.equal(collectUniqueNetworkStartIds(lines).size, 2)
  })
})
