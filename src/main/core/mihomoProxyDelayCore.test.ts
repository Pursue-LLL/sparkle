import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isHy2TunnelVitalityDelayPurpose,
  isMarathonRescueDelayPurpose,
  isMihomoApiResourceNotFoundError,
  isUserExplicitDelayPurpose,
  resolveProviderNameForLeaf,
  resolveProviderRefreshDialKind,
  shouldBypassMarathonQuiesceForDelay,
  shouldBypassMihomoDelayProbeSlot,
  shouldRefreshProviderLeafBeforeDelay,
} from './mihomoProxyDelayCore'

describe('mihomoProxyDelayCore', () => {
  it('isMarathonRescueDelayPurpose bypasses quiesce gate only for marathon_rescue', () => {
    assert.equal(isMarathonRescueDelayPurpose('marathon_rescue'), true)
    assert.equal(isMarathonRescueDelayPurpose('default'), false)
    assert.equal(isMarathonRescueDelayPurpose(undefined), false)
    assert.equal(isMarathonRescueDelayPurpose('user_explicit'), false)
  })

  it('shouldRefreshProviderLeafBeforeDelay for marathon_rescue and user_explicit', () => {
    assert.equal(shouldRefreshProviderLeafBeforeDelay('marathon_rescue'), true)
    assert.equal(shouldRefreshProviderLeafBeforeDelay('user_explicit'), true)
    assert.equal(shouldRefreshProviderLeafBeforeDelay('default'), false)
    assert.equal(shouldRefreshProviderLeafBeforeDelay(undefined), false)
  })

  it('resolveProviderRefreshDialKind maps user_explicit to managed_ui_delay_test', () => {
    assert.equal(resolveProviderRefreshDialKind('user_explicit'), 'managed_ui_delay_test')
    assert.equal(resolveProviderRefreshDialKind('marathon_rescue'), 'provider_healthcheck_api')
    assert.equal(resolveProviderRefreshDialKind(undefined), 'provider_healthcheck_api')
  })

  it('isUserExplicitDelayPurpose identifies managed UI delay', () => {
    assert.equal(isUserExplicitDelayPurpose('user_explicit'), true)
    assert.equal(isUserExplicitDelayPurpose('marathon_rescue'), false)
  })

  it('shouldBypassMihomoDelayProbeSlot for marathon_rescue and hy2_tunnel_vitality', () => {
    assert.equal(shouldBypassMihomoDelayProbeSlot('marathon_rescue'), true)
    assert.equal(shouldBypassMihomoDelayProbeSlot('hy2_tunnel_vitality'), true)
    assert.equal(shouldBypassMihomoDelayProbeSlot('default'), false)
    assert.equal(shouldBypassMihomoDelayProbeSlot(undefined), false)
  })

  it('P27 hy2_tunnel_vitality bypasses quiesce but not provider refresh', () => {
    assert.equal(isHy2TunnelVitalityDelayPurpose('hy2_tunnel_vitality'), true)
    assert.equal(shouldBypassMarathonQuiesceForDelay('hy2_tunnel_vitality'), true)
    assert.equal(shouldRefreshProviderLeafBeforeDelay('hy2_tunnel_vitality'), false)
  })

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
            proxies: [{ name: 'JP-VPS-HY2', type: 'Hysteria2', alive: true, history: [] }],
          },
        },
      },
      'JP-VPS-HY2',
    )
    assert.equal(providerName, '199e64b94e8-vps')
  })
})
