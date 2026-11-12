import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildRecoveredProfileItemFromDisk,
  isBlankProfileConfigRaw,
  isEmptyPersistableProfileConfig,
  mergeProfileConfigItems,
  profileIdFromSubscriptionFile
} from './profileConfigRecoveryPureCore'

const item = (id: string, name = id): ProfileItem => ({ id, name, type: 'remote' })

describe('isBlankProfileConfigRaw', () => {
  it('treats empty or whitespace-only files as blank', () => {
    assert.equal(isBlankProfileConfigRaw(''), true)
    assert.equal(isBlankProfileConfigRaw('  \n\t\n'), true)
  })

  it('treats an items list without entries as blank, in either YAML spelling', () => {
    assert.equal(isBlankProfileConfigRaw('current: a\nitems: []\n'), true)
    assert.equal(isBlankProfileConfigRaw('current: a\nitems:\n'), true)
  })

  it('treats a file without any item entry as blank', () => {
    assert.equal(isBlankProfileConfigRaw('current: a\n'), true)
  })

  it('keeps a file that lists at least one item', () => {
    assert.equal(isBlankProfileConfigRaw('items:\n  - id: abc\n    name: x\n'), false)
  })

  it('does not call a file blank just because an empty items key is also present', () => {
    assert.equal(isBlankProfileConfigRaw('items: []\n- id: abc\n'), false)
  })
})

describe('isEmptyPersistableProfileConfig', () => {
  it('is empty when items are missing, not an array, or have no entries', () => {
    assert.equal(isEmptyPersistableProfileConfig({} as ProfileConfig), true)
    assert.equal(isEmptyPersistableProfileConfig({ items: [] } as ProfileConfig), true)
    assert.equal(
      isEmptyPersistableProfileConfig({ items: 'oops' } as unknown as ProfileConfig),
      true
    )
  })

  it('is not empty once an item exists', () => {
    assert.equal(isEmptyPersistableProfileConfig({ items: [item('a')] } as ProfileConfig), false)
  })
})

describe('profileIdFromSubscriptionFile', () => {
  it('derives the profile id from a plain subscription file', () => {
    assert.equal(profileIdFromSubscriptionFile('77caf1sub001.yaml'), '77caf1sub001')
  })

  it('ignores the default profile, non-yaml files and auxiliary outputs', () => {
    assert.equal(profileIdFromSubscriptionFile('default.yaml'), null)
    assert.equal(profileIdFromSubscriptionFile('abc.yml'), null)
    assert.equal(profileIdFromSubscriptionFile('abc.json'), null)
    assert.equal(profileIdFromSubscriptionFile('abc-proxies.yaml'), null)
    assert.equal(profileIdFromSubscriptionFile('abc-vps-proxies.yaml'), null)
    assert.equal(profileIdFromSubscriptionFile('abc-raw-download.yaml'), null)
  })
})

describe('mergeProfileConfigItems', () => {
  it('keeps the primary list first and appends only unseen secondary items', () => {
    const primary = [item('a', 'primary-a'), item('b')]
    const secondary = [item('b', 'secondary-b'), item('c'), item('c', 'secondary-c')]

    const merged = mergeProfileConfigItems(primary, secondary)

    assert.deepEqual(
      merged.map((entry) => `${entry.id}:${entry.name}`),
      ['a:primary-a', 'b:b', 'c:c']
    )
  })

  it('does not modify either input', () => {
    const primary = [item('a')]
    const secondary = [item('b')]

    mergeProfileConfigItems(primary, secondary)

    assert.deepEqual(primary, [item('a')])
    assert.deepEqual(secondary, [item('b')])
  })
})

describe('buildRecoveredProfileItemFromDisk', () => {
  it('names the known subscriptions and falls back to the id', () => {
    assert.equal(buildRecoveredProfileItemFromDisk('77caf1sub001', 1).name, '移动订阅')
    assert.equal(buildRecoveredProfileItemFromDisk('678a1sub001', 1).name, '主订阅')
    assert.equal(buildRecoveredProfileItemFromDisk('custom', 1).name, 'custom')
  })

  it('rebuilds a remote subscription that updates daily, carrying the file time', () => {
    assert.deepEqual(buildRecoveredProfileItemFromDisk('custom', 1_700_000_000_000), {
      id: 'custom',
      name: 'custom',
      type: 'remote',
      verify: false,
      autoUpdate: true,
      disableRemoteInterval: true,
      substore: false,
      interval: 240,
      updateTime: '07:00',
      override: ['c7sgvps01'],
      useProxy: false,
      updated: 1_700_000_000_000,
      locked: false
    })
  })
})
