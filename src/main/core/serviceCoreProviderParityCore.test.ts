import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectProxyProviderIds,
  collectRunningProxyProviderIds,
  formatProviderParityMismatchLog,
  shouldRestartServiceCoreForProviderParity
} from './serviceCoreProviderParityCore.ts'

describe('serviceCoreProviderParityCore', () => {
  it('collectProxyProviderIds returns sorted keys', () => {
    assert.deepEqual(
      collectProxyProviderIds({
        'proxy-providers': {
          '77caf1sub001-vps': {},
          '77caf1sub001': {}
        }
      }),
      ['77caf1sub001', '77caf1sub001-vps']
    )
  })

  it('collectRunningProxyProviderIds excludes Compatible vehicle type', () => {
    assert.deepEqual(
      collectRunningProxyProviderIds({
        COMPATIBLE: { vehicleType: 'Compatible' },
        '678a1sub001': { vehicleType: 'File' }
      }),
      ['678a1sub001']
    )
  })

  it('shouldRestartServiceCoreForProviderParity detects subscription switch', () => {
    assert.equal(
      shouldRestartServiceCoreForProviderParity(['77caf1sub001', '77caf1sub001-vps'], {
        '678a1sub001': { vehicleType: 'File' },
        '678a1sub001-vps': { vehicleType: 'File' }
      }),
      true
    )
  })

  it('shouldRestartServiceCoreForProviderParity is false when sets match', () => {
    assert.equal(
      shouldRestartServiceCoreForProviderParity(['77caf1sub001'], {
        '77caf1sub001': { vehicleType: 'File' }
      }),
      false
    )
  })

  it('formatProviderParityMismatchLog renders both sides', () => {
    assert.equal(
      formatProviderParityMismatchLog(['77caf1sub001'], ['678a1sub001']),
      'expected=[77caf1sub001] running=[678a1sub001]'
    )
  })
})
