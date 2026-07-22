import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyVlessVisionMuxGuard,
  isVlessVisionProxy,
  normalizeVlessVisionProxy,
  summarizeVlessVisionMuxGuard
} from './vlessVisionMuxGuardCore'

describe('vlessVisionMuxGuardCore', () => {
  it('detects vless vision proxies', () => {
    assert.equal(
      isVlessVisionProxy({ type: 'vless', flow: 'xtls-rprx-vision', name: 'KR-VPS-Reality' }),
      true
    )
    assert.equal(isVlessVisionProxy({ type: 'vless', flow: '', name: 'plain' }), false)
    assert.equal(isVlessVisionProxy({ type: 'hysteria2', name: 'HY2' }), false)
  })

  it('strips multiplex and unconditionally forces smux off for vision nodes', () => {
    const input = {
      name: 'KR-VPS-Reality',
      type: 'vless',
      flow: 'xtls-rprx-vision',
      multiplex: { enabled: true, protocol: 'smux' },
      smux: true
    }
    const result = normalizeVlessVisionProxy(input)
    assert.equal(result.strippedMultiplex, true)
    assert.equal(result.ensuredSmuxOff, true)
    assert.equal('multiplex' in result.proxy, false)
    assert.equal(result.proxy.smux, false)
  })

  it('writes smux false even when multiplex and smux are absent (implicit mux guard)', () => {
    const input = {
      name: 'JP-VPS-Reality',
      type: 'vless',
      flow: 'xtls-rprx-vision'
    }
    const result = normalizeVlessVisionProxy(input)
    assert.equal(result.strippedMultiplex, false)
    assert.equal(result.ensuredSmuxOff, true)
    assert.equal(result.proxy.smux, false)
    assert.equal('multiplex' in result.proxy, false)
  })

  it('leaves non-vision proxies untouched', () => {
    const hy2 = { name: 'KR-VPS-HY2', type: 'hysteria2', mtu: 1500 }
    const out = applyVlessVisionMuxGuard([hy2])
    assert.deepEqual(out[0], hy2)
  })

  it('summarizes guard actions for all vision nodes', () => {
    const summary = summarizeVlessVisionMuxGuard([
      { name: 'KR-VPS-Reality', type: 'vless', flow: 'xtls-rprx-vision', multiplex: { enabled: true } },
      { name: 'JP-VPS-Reality', type: 'vless', flow: 'xtls-rprx-vision' },
      { name: 'KR-VPS-HY2', type: 'hysteria2' }
    ])
    assert.equal(summary.visionNodeCount, 2)
    assert.equal(summary.strippedMultiplexCount, 1)
    assert.equal(summary.ensuredSmuxOffCount, 2)
    assert.deepEqual(summary.visionNodeNames, ['KR-VPS-Reality', 'JP-VPS-Reality'])
  })
})
