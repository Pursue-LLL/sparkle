import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deepMerge } from '../../../main/utils/merge'
import { previewConfigPatch } from './config-patch-preview'

type Config = Record<string, unknown>

const CURRENT: Config = {
  mode: 'rule',
  'allow-lan': false,
  tun: { enable: false, stack: 'mixed', 'dns-hijack': ['any:53'] },
  dns: { enable: true, nameserver: ['223.5.5.5'], 'fake-ip-filter': ['+.lan'] },
  sniffer: { enable: true, sniff: { HTTP: { ports: [80] } } }
}

describe('previewConfigPatch', () => {
  it('matches the main-process deepMerge for the patches the switches send', () => {
    const patches: Config[] = [
      { tun: { enable: true }, dns: { enable: true } },
      { tun: { enable: false } },
      { mode: 'global' },
      { 'allow-lan': true },
      { dns: { nameserver: ['1.1.1.1', '8.8.8.8'] } },
      { tun: { 'dns-hijack': [] } },
      { sniffer: { sniff: { HTTP: { ports: [80, 8080] } } } },
      { tun: { device: null } },
      { newSection: { nested: { flag: true } } },
      {}
    ]

    for (const patch of patches) {
      const expected = deepMerge(structuredClone(CURRENT), structuredClone(patch))
      assert.deepEqual(previewConfigPatch(CURRENT, patch), expected, JSON.stringify(patch))
    }
  })

  it('replaces arrays instead of merging them', () => {
    const next = previewConfigPatch(CURRENT, { dns: { nameserver: ['1.1.1.1'] } })

    assert.deepEqual((next.dns as Config).nameserver, ['1.1.1.1'])
    assert.equal((next.dns as Config).enable, true)
  })

  it('does not mutate the current config or the patch', () => {
    const current = structuredClone(CURRENT)
    const patch: Config = { tun: { enable: true } }
    const patchSnapshot = structuredClone(patch)

    previewConfigPatch(current, patch)

    assert.deepEqual(current, CURRENT)
    assert.deepEqual(patch, patchSnapshot)
  })

  it('keeps untouched subtrees by reference so unrelated consumers do not re-render', () => {
    const next = previewConfigPatch(CURRENT, { tun: { enable: true } })

    assert.notEqual(next, CURRENT)
    assert.notEqual(next.tun, CURRENT.tun)
    assert.equal(next.dns, CURRENT.dns)
    assert.equal(next.sniffer, CURRENT.sniffer)
  })

  it('builds the patched shape when no config has been loaded yet', () => {
    assert.deepEqual(previewConfigPatch<Config>(undefined, { tun: { enable: true } }), {
      tun: { enable: true }
    })
  })

  it('replaces a non-object value with the patched object', () => {
    assert.deepEqual(previewConfigPatch<Config>({ tun: null }, { tun: { enable: true } }), {
      tun: { enable: true }
    })
  })
})
