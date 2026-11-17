import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ANYTLS_DISABLE_REUSE_KEY,
  applyAnytlsReuseGuard,
  isAnytlsProxy,
  normalizeAnytlsProxy,
  summarizeAnytlsReuseGuard
} from './anytlsReuseGuardCore'

type Proxy = Record<string, unknown>

const anytls = (name: string, extra: Proxy = {}): Proxy => ({
  name,
  type: 'anytls',
  server: 'node.example.com',
  port: 8443,
  password: 'secret',
  'client-fingerprint': 'chrome',
  alpn: ['h2', 'http/1.1'],
  'ech-opts': { enable: true },
  ...extra
})

describe('anytlsReuseGuardCore', () => {
  it('names the exact option key mihomo reads', () => {
    assert.equal(ANYTLS_DISABLE_REUSE_KEY, 'disable-reuse')
  })

  describe('isAnytlsProxy', () => {
    it('recognises the one spelling mihomo accepts', () => {
      assert.equal(isAnytlsProxy({ type: 'anytls' }), true)
    })

    it('rejects every other protocol, including near-miss and mis-cased names', () => {
      const others = ['trojan', 'vless', 'hysteria2', 'anytls2', 'xanytls', 'any tls', '']
      const spellings = ['AnyTLS', 'ANYTLS', ' anytls ']
      for (const type of [...others, ...spellings]) {
        assert.equal(isAnytlsProxy({ type }), false, type)
      }
    })

    it('rejects values that are not a proxy record or have no usable type', () => {
      for (const value of [null, undefined, 'anytls', 42, ['anytls'], {}, { type: 7 }]) {
        assert.equal(isAnytlsProxy(value), false)
      }
      assert.equal(isAnytlsProxy({ type: ['anytls'] }), false)
    })
  })

  describe('normalizeAnytlsProxy', () => {
    it('turns session reuse off and leaves every other field exactly as it was', () => {
      const input = Object.freeze(anytls('台湾 01'))

      const output = normalizeAnytlsProxy(input)

      assert.deepEqual(output, anytls('台湾 01', { 'disable-reuse': true }))
      assert.equal(Object.hasOwn(output, 'disable-reuse'), true)
      assert.equal(Object.hasOwn(input, 'disable-reuse'), false)
      assert.notEqual(output, input)
    })

    it('keeps an explicit value, including false, untouched', () => {
      const keepsReuse = anytls('a', { 'disable-reuse': false })
      const alreadyOff = anytls('b', { 'disable-reuse': true })

      assert.equal(normalizeAnytlsProxy(keepsReuse), keepsReuse)
      assert.equal(keepsReuse['disable-reuse'], false)
      assert.equal(normalizeAnytlsProxy(alreadyOff), alreadyOff)
    })

    it('treats a key written without a value as not set', () => {
      assert.equal(
        normalizeAnytlsProxy(anytls('a', { 'disable-reuse': null }))['disable-reuse'],
        true
      )
      assert.equal(
        normalizeAnytlsProxy(anytls('b', { 'disable-reuse': undefined }))['disable-reuse'],
        true
      )
    })
  })

  describe('applyAnytlsReuseGuard', () => {
    it('guards only AnyTLS nodes and keeps order, length and every other entry as it was', () => {
      const trojan = Object.freeze({ name: 'T', type: 'trojan' })
      const hysteria = Object.freeze({ name: 'H', type: 'hysteria2', mtu: 1500 })
      const input = Object.freeze([
        trojan,
        Object.freeze(anytls('A1')),
        null,
        'stray',
        hysteria,
        Object.freeze(anytls('A2', { port: 443 }))
      ])

      const output = applyAnytlsReuseGuard(input as unknown as unknown[])

      assert.equal(output.length, input.length)
      assert.equal(output[0], trojan)
      assert.equal(output[2], null)
      assert.equal(output[3], 'stray')
      assert.equal(output[4], hysteria)
      assert.deepEqual(output[1], anytls('A1', { 'disable-reuse': true }))
      assert.deepEqual(output[5], anytls('A2', { port: 443, 'disable-reuse': true }))
      assert.equal(Object.hasOwn(trojan, 'disable-reuse'), false)
      assert.equal(Object.hasOwn(hysteria, 'disable-reuse'), false)
    })

    it('is idempotent: a second pass changes nothing and copies nothing', () => {
      const once = applyAnytlsReuseGuard([anytls('A1'), anytls('A2', { 'disable-reuse': false })])

      const twice = applyAnytlsReuseGuard(once)

      assert.deepEqual(twice, once)
      assert.equal(twice[0], once[0])
      assert.equal(twice[1], once[1])
    })

    it('handles an empty list', () => {
      assert.deepEqual(applyAnytlsReuseGuard([]), [])
    })
  })

  describe('summarizeAnytlsReuseGuard', () => {
    it('reports the state after the guard, so explicit reuse shows up as the difference', () => {
      const summary = summarizeAnytlsReuseGuard([
        { name: 'T', type: 'trojan' },
        anytls('A1'),
        anytls('A2', { 'disable-reuse': true }),
        anytls('A3', { 'disable-reuse': false }),
        { type: 'anytls' }
      ])

      assert.deepEqual(summary, {
        nodeCount: 4,
        reuseDisabledCount: 3,
        nodeNames: ['A1', 'A2', 'A3', '(unnamed)']
      })
    })

    it('reports nothing when there is no AnyTLS node', () => {
      assert.deepEqual(summarizeAnytlsReuseGuard([{ name: 'T', type: 'trojan' }, null]), {
        nodeCount: 0,
        reuseDisabledCount: 0,
        nodeNames: []
      })
    })
  })
})
