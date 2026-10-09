import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isMihomoApiResourceNotFoundError,
  resolveProviderNameForLeaf,
} from './mihomoProxyDelayCore'

describe('mihomoProxyDelayCore', () => {
  it('detects mihomo REST Resource not found reject payload', () => {
    assert.equal(isMihomoApiResourceNotFoundError({ message: 'Resource not found' }), true)
    assert.equal(isMihomoApiResourceNotFoundError(new Error('Resource not found')), true)
    assert.equal(isMihomoApiResourceNotFoundError({ message: 'timeout' }), false)
  })

  it('resolveProviderNameForLeaf finds VPS provider bucket', () => {
    const providerName = resolveProviderNameForLeaf(
      {
        providers: {
          '199e64b94e8-vps': {
            name: '199e64b94e8-vps',
            type: 'Proxy',
            vehicleType: 'HTTP',
            expectedStatus: '200',
            proxies: [{ name: 'KR-VPS-HY2', type: 'Hysteria2', alive: true, history: [] } as unknown as ControllerProxiesDetail],
          },
        },
      },
      'KR-VPS-HY2',
    )
    assert.equal(providerName, '199e64b94e8-vps')
  })
})
