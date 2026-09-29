import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatMissingSubscriptionUrlError } from './profileCacheRefreshPureCore'

describe('profileCacheRefreshCore', () => {
  it('formatMissingSubscriptionUrlError is bilingual-ready', () => {
    assert.match(formatMissingSubscriptionUrlError('zh'), /订阅 URL 为空/)
    assert.match(formatMissingSubscriptionUrlError('en'), /Subscription URL is empty/)
  })
})
