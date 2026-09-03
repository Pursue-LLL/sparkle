import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRecoveredProfileItemFromDisk,
  mergeProfileConfigItems,
  profileIdFromSubscriptionFile
} from './profileConfigRecoveryPureCore.ts'

describe('profileConfigRecoveryCore', () => {
  it('profileIdFromSubscriptionFile ignores auxiliary provider files', () => {
    assert.equal(profileIdFromSubscriptionFile('77caf1sub001.yaml'), '77caf1sub001')
    assert.equal(profileIdFromSubscriptionFile('77caf1sub001-proxies.yaml'), null)
    assert.equal(profileIdFromSubscriptionFile('default.yaml'), null)
  })

  it('mergeProfileConfigItems preserves backup and adds disk-only profiles', () => {
    const merged = mergeProfileConfigItems(
      [{ id: '678a1sub001', name: '主订阅', type: 'remote' }],
      [{ id: '77caf1sub001', name: '移动订阅', type: 'remote' }]
    )
    assert.deepEqual(
      merged.map((item) => item.id),
      ['678a1sub001', '77caf1sub001']
    )
  })

  it('buildRecoveredProfileItemFromDisk keeps override linkage', () => {
    const item = buildRecoveredProfileItemFromDisk('77caf1sub001', 123)
    assert.equal(item.override?.[0], 'c7sgvps01')
    assert.equal(item.name, '移动订阅')
  })
})
