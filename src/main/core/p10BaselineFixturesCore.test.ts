import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateP10BadRulerFixture,
  evaluateP10BaselineManifestFixture,
  evaluateP10Code8UnknownGolden,
  evaluateP10UnsupportedRegionGolden,
  evaluateP10WorkbenchStockPatchedDiff,
  evaluateP10_660d7a6fEvidenceGap,
  P10_BAD_RULER_FIXTURE,
} from './p10BaselineFixturesCore'

describe('p10BaselineFixturesCore P10-0', () => {
  it('marks current bad ruler fixture invalid', () => {
    const verdict = evaluateP10BadRulerFixture(P10_BAD_RULER_FIXTURE)
    assert.equal(verdict.ok, true)
    assert.match(verdict.detail, /invalid/)
  })

  it('preserves 07-30 unsupported_region golden', () => {
    const ok = evaluateP10UnsupportedRegionGolden('ERROR_UNSUPPORTED_REGION')
    assert.equal(ok.ok, true)
  })

  it('keeps 07-21 code8 without inner details unknown', () => {
    const verdict = evaluateP10Code8UnknownGolden(false)
    assert.equal(verdict.ok, true)
  })

  it('freezes stock vs patched workbench diff @ P10-0', () => {
    const verdict = evaluateP10WorkbenchStockPatchedDiff()
    assert.equal(verdict.ok, true)
    assert.match(verdict.detail, /patch-482/)
  })

  it('freezes mac/vps baseline manifest hashes', () => {
    const verdict = evaluateP10BaselineManifestFixture()
    assert.equal(verdict.ok, true)
  })

  it('blocks definitive 660d7a6f root cause without three-age proof', () => {
    const verdict = evaluateP10_660d7a6fEvidenceGap()
    assert.equal(verdict.ok, true)
    assert.match(verdict.detail, /single-axis/)
  })
})
