import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AGY_LOCATION_REJECTION, classifyAgyProbeResponse } from './sparkleAgyProviderCore'

describe('classifyAgyProbeResponse', () => {
  it('treats HTTP 200 as a usable node', () => {
    assert.equal(classifyAgyProbeResponse(200, '{"choices":[]}'), 'usable')
  })

  it('treats the location violation of the generation request as unusable', () => {
    const body =
      '{"error":{"message":"Antigravity: User location is not supported for the API use."}}'
    assert.equal(classifyAgyProbeResponse(400, body), 'unusable')
  })

  it('treats the aicode location rejection as unusable as well', () => {
    const body = '"reason": "LOCATION_NOT_ELIGIBLE", "detected_location": "CN"'
    assert.equal(classifyAgyProbeResponse(400, body), 'unusable')
  })

  it('keeps other 400s and rate limits undecided', () => {
    assert.equal(classifyAgyProbeResponse(400, '{"error":{"message":"bad request"}}'), 'unknown')
    assert.equal(classifyAgyProbeResponse(429, '{"error":{"message":"quota"}}'), 'unknown')
    assert.equal(classifyAgyProbeResponse(500, 'oops'), 'unknown')
  })

  it('only judges a rejection that arrives as a 400', () => {
    assert.equal(classifyAgyProbeResponse(500, 'User location is not supported'), 'unknown')
    assert.equal(classifyAgyProbeResponse(403, '"reason": "LOCATION_NOT_ELIGIBLE"'), 'unknown')
  })

  it('flags 404/405 as fatal (magpie model/route mismatch)', () => {
    assert.equal(classifyAgyProbeResponse(404, 'not found'), 'fatal')
    assert.equal(classifyAgyProbeResponse(405, 'method not allowed'), 'fatal')
  })
})

describe('AGY_LOCATION_REJECTION', () => {
  const rejections = [
    'FAILED_PRECONDITION (code 400): User location is not supported for the API use.',
    'USER LOCATION IS NOT SUPPORTED',
    '"reason": "LOCATION_NOT_ELIGIBLE",',
    'location_not_eligible'
  ]
  for (const text of rejections) {
    it(`recognizes "${text}"`, () => {
      assert.equal(AGY_LOCATION_REJECTION.test(text), true)
    })
  }

  const harmless = [
    'AICode FetchConfig failed: Get "https://aicode.googleapis.com/v1alpha:fetchConfig": context deadline exceeded',
    'Print mode: starting (promptLength=22, model="gemini-3.8-flash-low")',
    '"detected_location": "US"'
  ]
  for (const text of harmless) {
    it(`leaves "${text.slice(0, 40)}…" alone`, () => {
      assert.equal(AGY_LOCATION_REJECTION.test(text), false)
    })
  }

  it('can be reused for repeated checks without remembering the previous one', () => {
    const text = 'User location is not supported'
    assert.equal(AGY_LOCATION_REJECTION.test(text), true)
    assert.equal(AGY_LOCATION_REJECTION.test(text), true)
  })
})
