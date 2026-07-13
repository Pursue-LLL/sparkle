import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyHysteria2ProxiesQuicStability,
  CURSOR_HY2_MTU,
  normalizeHysteria2Proxy,
} from './hysteria2QuicStability'

test('normalizeHysteria2Proxy caps mtu and sets h3 alpn', () => {
  const out = normalizeHysteria2Proxy({ name: 'KR-VPS-HY2', type: 'hysteria2', mtu: 1500 })
  assert.equal(out.mtu, CURSOR_HY2_MTU)
  assert.deepEqual(out.alpn, ['h3'])
})

test('normalizeHysteria2Proxy preserves user mtu at or below cap', () => {
  const out = normalizeHysteria2Proxy({ name: 'x', type: 'hysteria2', mtu: 1200, alpn: ['h3', 'h2'] })
  assert.equal(out.mtu, 1200)
  assert.deepEqual(out.alpn, ['h3', 'h2'])
})

test('applyHysteria2ProxiesQuicStability skips non-hy2', () => {
  const proxies = [{ name: 'x', type: 'ss' }, { name: 'y', type: 'hysteria2' }]
  const out = applyHysteria2ProxiesQuicStability(proxies)
  assert.equal((out[0] as { mtu?: number }).mtu, undefined)
  assert.equal((out[1] as { mtu?: number }).mtu, CURSOR_HY2_MTU)
})
