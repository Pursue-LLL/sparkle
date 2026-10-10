import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  POOLED_HISTORY_LIMIT,
  poolProxyInstances,
  resolveProbeHistory,
  resolveProbeRecord
} from './proxyProbeHistoryCore'

const GEMINI = 'https://gemini.google.com'
const GENERAL_HTTP = 'http://www.gstatic.com/generate_204'
const GENERAL_HTTPS = 'https://www.gstatic.com/generate_204'

const sample = (time: string, delay: number): ControllerProxiesHistory => ({
  time: `2026-10-10T${time}.690660+08:00`,
  delay
})

function detail(overrides: Partial<ControllerProxiesDetail>): ControllerProxiesDetail {
  return {
    name: 'node',
    type: 'Hysteria2',
    alive: true,
    history: [],
    extra: {},
    id: 'node',
    tfo: false,
    udp: true,
    xudp: false,
    mptcp: false,
    smux: false,
    uot: false,
    'dialer-proxy': '',
    interface: '',
    'routing-mark': 0,
    ...overrides
  }
}

describe('resolveProbeRecord', () => {
  // 线上形态：顶层 history 把两个探测地址的样本按时间交错混在一起
  const mixed = detail({
    history: [sample('10:06:19', 0), sample('10:06:28', 0), sample('10:11:15', 329), sample('10:11:31', 0)],
    extra: {
      [GEMINI]: { alive: false, history: [sample('10:06:28', 0), sample('10:11:31', 0)] },
      [GENERAL_HTTP]: { alive: true, history: [sample('10:06:19', 0), sample('10:11:15', 329)] }
    }
  })

  it('reads only the samples of the requested probe url instead of the mixed top-level history', () => {
    assert.deepEqual(
      resolveProbeHistory(mixed, GEMINI).map((entry) => entry.delay),
      [0, 0]
    )
    assert.deepEqual(
      resolveProbeHistory(mixed, GENERAL_HTTP).map((entry) => entry.delay),
      [0, 329]
    )
    assert.equal(resolveProbeRecord(mixed, GEMINI).alive, false)
    assert.equal(resolveProbeRecord(mixed, GENERAL_HTTP).alive, true)
  })

  it('matches probe urls regardless of http/https scheme and trailing slash', () => {
    assert.equal(resolveProbeHistory(mixed, GENERAL_HTTPS).length, 2)
    assert.equal(resolveProbeHistory(mixed, 'https://GEMINI.google.com/').length, 2)
  })

  it('reports an untested url as empty instead of borrowing other urls samples', () => {
    const record = resolveProbeRecord(mixed, 'https://api2.cursor.sh')
    assert.deepEqual(record.history, [])
    assert.equal(record.alive, undefined)
  })

  it('falls back to the single history when the node has no per-url records or no url is given', () => {
    const plain = detail({ alive: true, history: [sample('10:00:00', 120)], extra: {} })
    assert.equal(resolveProbeHistory(plain, GEMINI).length, 1)
    assert.equal(resolveProbeHistory(mixed, undefined).length, 4)
    assert.equal(resolveProbeRecord(plain, GEMINI).alive, true)
  })
})

describe('poolProxyInstances', () => {
  // 线上形态：同一节点在两个 provider 里各探测一份，Gemini 结论互相矛盾
  const fromProfile = detail({
    alive: false,
    history: [sample('10:26:25', 0)],
    extra: {
      [GEMINI]: { alive: false, history: [sample('10:21:25', 0), sample('10:26:25', 0)] },
      [GENERAL_HTTP]: { alive: true, history: [sample('10:26:11', 303)] }
    }
  })
  const fromFast = detail({
    alive: true,
    history: [sample('10:26:18', 191)],
    extra: {
      [GEMINI]: { alive: true, history: [sample('10:21:18', 0), sample('10:26:18', 191)] },
      [GENERAL_HTTP]: { alive: true, history: [sample('10:26:10', 92)] }
    }
  })

  it('merges samples of the same node by time, per probe url', () => {
    const pooled = poolProxyInstances(fromProfile, fromFast)
    assert.deepEqual(
      resolveProbeHistory(pooled, GEMINI).map((entry) => entry.delay),
      [0, 0, 191, 0]
    )
    assert.deepEqual(
      resolveProbeHistory(pooled, GENERAL_HTTP).map((entry) => entry.delay),
      [92, 303]
    )
  })

  it('is alive when either instance is alive', () => {
    const pooled = poolProxyInstances(fromProfile, fromFast)
    assert.equal(pooled.alive, true)
    assert.equal(resolveProbeRecord(pooled, GEMINI).alive, true)
  })

  it('produces the same result regardless of provider order', () => {
    assert.deepEqual(
      poolProxyInstances(fromProfile, fromFast).history,
      poolProxyInstances(fromFast, fromProfile).history
    )
  })

  it('drops duplicate timestamps and keeps only the most recent samples', () => {
    const many = (start: number): ControllerProxiesHistory[] =>
      Array.from({ length: 10 }, (_, index) => sample(`11:${String(start + index).padStart(2, '0')}:00`, 100 + index))
    const pooled = poolProxyInstances(detail({ history: many(0) }), detail({ history: many(5) }))
    assert.equal(pooled.history.length, POOLED_HISTORY_LIMIT)
    assert.equal(pooled.history.at(-1)?.time, sample('11:14:00', 0).time)
    assert.equal(new Set(pooled.history.map((entry) => entry.time)).size, POOLED_HISTORY_LIMIT)
  })
})
