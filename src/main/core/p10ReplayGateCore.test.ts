import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateP10DialStormGolden,
  runP10ReplayGate,
} from './p10ReplayGateCore'
import { P10_0801_DIAL_STORM_GOLDEN } from './p10BaselineFixturesCore'

describe('p10ReplayGateCore P10-6', () => {
  it('passes frozen baseline replay gate with default fixtures', () => {
    const gate = runP10ReplayGate()
    assert.equal(gate.ok, true)
    assert.equal(gate.nextGateAllowed, true)
    assert.ok(gate.verdicts.length >= 4)
  })

  it('recognizes 08-01 dial storm golden profile', () => {
    const verdict = evaluateP10DialStormGolden({
      pulseCount: P10_0801_DIAL_STORM_GOLDEN.pulseCount,
      rescueNudgeCount: P10_0801_DIAL_STORM_GOLDEN.rescueNudgeCount,
      recoveryIneffectiveCount: P10_0801_DIAL_STORM_GOLDEN.recoveryIneffectiveCount,
      windowMinutes: P10_0801_DIAL_STORM_GOLDEN.windowMinutes,
    })
    assert.equal(verdict.ok, true)
    assert.match(verdict.detail, /L2_L3/)
  })

  it('marks physical ruler valid when network_started coverage exists', () => {
    const gate = runP10ReplayGate({ physicalStartsCount: 5, ledgerHttpSegmentStarted: 10 })
    const physicalVerdict = gate.verdicts[gate.verdicts.length - 1]
    assert.equal(physicalVerdict?.ok, true)
  })
})
