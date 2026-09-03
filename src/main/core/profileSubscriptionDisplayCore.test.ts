import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatSubscriptionExpireDate,
  normalizeSubscriptionExpireTimestamp,
  subscriptionExpireDisplayLabel,
  subscriptionUpdateCardLabel,
  subscriptionUpdateTooltipLabel,
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

  it('shows daily schedule alongside relative update label', () => {
    assert.equal(
      subscriptionUpdateCardLabel(1788313034000, '1 天前', '07:00', 240),
      '每日 07:00 · 更新 1 天前',
    )
    assert.match(subscriptionUpdateTooltipLabel(1788313034000, '07:00', 240), /定时 07:00/)
  })
})
