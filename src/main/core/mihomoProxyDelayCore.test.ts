import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isMihomoApiResourceNotFoundError,
  resolveProviderNameForLeaf
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
            proxies: [
              {
                name: 'KR-VPS-HY2',
                type: 'Hysteria2',
                alive: true,
                history: []
              } as unknown as ControllerProxiesDetail
            ]
          }
        }
      },
      'KR-VPS-HY2'
    )
    assert.equal(providerName, '199e64b94e8-vps')
  })

  it('only recognises error objects whose message says the resource is missing', () => {
    assert.equal(
      isMihomoApiResourceNotFoundError(new Error('Request: resource NOT found (404)')),
      true
    )
    assert.equal(isMihomoApiResourceNotFoundError({ message: 123 }), false)
    assert.equal(isMihomoApiResourceNotFoundError({ code: 404 }), false)
    assert.equal(isMihomoApiResourceNotFoundError('Resource not found'), false)
    assert.equal(isMihomoApiResourceNotFoundError(null), false)
    assert.equal(isMihomoApiResourceNotFoundError(undefined), false)
  })

  describe('resolveProviderNameForLeaf', () => {
    const providers = {
      providers: {
        first: { proxies: [{ name: 'JP-01' }, { name: 'KR-01' }] },
        second: { proxies: [{ name: 'KR-01' }] },
        empty: {}
      }
    } as unknown as ControllerProxyProviders

    it('returns the first provider holding the node, ignoring surrounding spaces', () => {
      assert.equal(resolveProviderNameForLeaf(providers, ' KR-01 '), 'first')
      assert.equal(resolveProviderNameForLeaf(providers, 'JP-01'), 'first')
    })

    it('has no answer for a blank name, an unknown node or missing providers', () => {
      assert.equal(resolveProviderNameForLeaf(providers, '   '), undefined)
      assert.equal(resolveProviderNameForLeaf(providers, 'US-01'), undefined)
      assert.equal(resolveProviderNameForLeaf(null, 'JP-01'), undefined)
      assert.equal(resolveProviderNameForLeaf(undefined, 'JP-01'), undefined)
    })
  })
})
