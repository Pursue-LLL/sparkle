import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveProviderHealthCheckUrl } from './providerHealthCheckCore'
import { CURSOR_DELAY_TEST_URL } from './cursorProxyGroup'

describe('provider health-check URL', () => {
  it('uses api2 for providers that include VPS leaf nodes', () => {
    const url = resolveProviderHealthCheckUrl([
      { name: 'KR-VPS-Reality', type: 'vless' },
      { name: 'SG-01', type: 'ss' }
    ])
    assert.equal(url, CURSOR_DELAY_TEST_URL)
  })

  it('keeps generate_204 for commercial-only providers', () => {
    const url = resolveProviderHealthCheckUrl([{ name: 'SG-01', type: 'ss' }])
    assert.equal(url, 'http://www.gstatic.com/generate_204')
  })
})
