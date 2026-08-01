import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateP10BadRulerFixture,
  evaluateP10Code8UnknownGolden,
  evaluateP10UnsupportedRegionGolden,
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
})
