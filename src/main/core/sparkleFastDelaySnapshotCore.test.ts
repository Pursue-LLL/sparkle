import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildProviderFingerprint,
  hasSufficientSnapshotCoverage,
  parseSparkleFastDelaySnapshot,
  serializeSparkleFastDelaySnapshot,
  snapshotCoverage,
  type ProxyRecord
} from './sparkleFastDelaySnapshotCore'

function proxy(name: string, overrides: ProxyRecord = {}): ProxyRecord {
  return {
    name,
    type: 'hysteria2',
    server: `${name}.example.com`,
    ports: '10000-10100',
    sni: `${name}.sni.example.com`,
    password: 'secret',
    ...overrides
  }
}

function proxyList(count: number): ProxyRecord[] {
  return Array.from({ length: count }, (_, index) => proxy(`node-${index + 1}`))
}

describe('sparkleFastDelaySnapshotCore fingerprint', () => {
  it('is independent of provider order and runtime-only fields', () => {
    const a = [
      proxy('b', { history: [{ delay: 1 }], alive: true, extra: { url: { alive: true } } }),
      proxy('a')
    ]
    const b = [proxy('a'), proxy('b')]
    assert.equal(buildProviderFingerprint(a), buildProviderFingerprint(b))
  })

  it('changes when SNI, server, port or ports change', () => {
    const base = [proxy('a')]
    const baseline = buildProviderFingerprint(base)
    for (const overrides of [
      { sni: 'changed.sni.example.com' },
      { server: 'changed.example.com' },
      { port: 8443 },
      { ports: '20000-20100' }
    ]) {
      assert.notEqual(buildProviderFingerprint([proxy('a', overrides)]), baseline)
    }
  })
})

describe('sparkleFastDelaySnapshotCore coverage', () => {
  const proxies = proxyList(24)

  it('counts only current provider names, not stale snapshot names', () => {
    const samples = new Map<string, number>()
    for (const proxy of proxies.slice(0, 9)) {
      samples.set(String(proxy.name), 100)
    }
    samples.set('removed-node', 50)
    samples.set('another-removed-node', 60)

    const coverage = snapshotCoverage(proxies, samples)
    assert.deepEqual(coverage, { covered: 9, total: 24, ratio: 9 / 24 })
    assert.equal(hasSufficientSnapshotCoverage(proxies, samples), false)
  })

  it('requires at least 80% coverage before trusting a disk snapshot', () => {
    const nineteen = new Map(proxies.slice(0, 19).map((p) => [String(p.name), 100]))
    const twenty = new Map(proxies.slice(0, 20).map((p) => [String(p.name), 100]))
    assert.equal(hasSufficientSnapshotCoverage(proxies, nineteen), false)
    assert.equal(hasSufficientSnapshotCoverage(proxies, twenty), true)
  })

  it('never trusts an empty provider or empty snapshot', () => {
    assert.equal(hasSufficientSnapshotCoverage([], new Map()), false)
    assert.equal(hasSufficientSnapshotCoverage(proxies, new Map()), false)
  })
})

describe('sparkleFastDelaySnapshotCore parse/serialize', () => {
  const proxies = [proxy('a'), proxy('b')]

  it('round-trips a matching snapshot', () => {
    const serialized = serializeSparkleFastDelaySnapshot(
      proxies,
      new Map([
        ['a', 120],
        ['b', 240]
      ])
    )
    const parsed = parseSparkleFastDelaySnapshot(serialized, proxies)
    assert.deepEqual(
      [...parsed.entries()],
      [
        ['a', 120],
        ['b', 240]
      ]
    )
  })

  it('rejects a legacy bare map and a mismatched fingerprint', () => {
    assert.equal(parseSparkleFastDelaySnapshot('{"a":120}', proxies).size, 0)

    const serialized = serializeSparkleFastDelaySnapshot(proxies, new Map([['a', 120]]))
    const changed = [proxy('a', { sni: 'new.sni.example.com' }), proxy('b')]
    assert.equal(parseSparkleFastDelaySnapshot(serialized, changed).size, 0)
  })

  it('drops stale names and invalid delays when serializing', () => {
    const serialized = serializeSparkleFastDelaySnapshot(
      proxies,
      new Map([
        ['a', 120],
        ['b', 0],
        ['removed', 80]
      ])
    )
    const parsed = JSON.parse(serialized) as { samples: Record<string, number> }
    assert.deepEqual(parsed.samples, { a: 120 })
  })
})
