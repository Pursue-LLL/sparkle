import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatSubscriptionExpireDate,
  normalizeSubscriptionExpireTimestamp,
  subscriptionExpireDisplayLabel,
} from './profileSubscriptionDisplayCore'

describe('profileSubscriptionDisplayCore', () => {
  it('keeps unix seconds expire unchanged', () => {
    const sec = 1_807_190_400
    assert.equal(normalizeSubscriptionExpireTimestamp(sec), sec)
    assert.match(formatSubscriptionExpireDate(sec), /^2027-/)
  })

  it('normalizes millisecond expire to seconds', () => {
    const sec = 1_807_190_400
    assert.equal(normalizeSubscriptionExpireTimestamp(sec * 1000), sec)
  })

  it('labels expire display to avoid update-time confusion', () => {
    assert.match(subscriptionExpireDisplayLabel(1_807_190_400), /^到期 2027-/)
  })
})
