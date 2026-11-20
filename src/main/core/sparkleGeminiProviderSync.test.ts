import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertLog,
  assertNoLog,
  cacheKey,
  cacheRecord,
  callsStarting,
  DAY_MS,
  NODES,
  NOW,
  providerSync,
  readGeminiProviderOrder,
  UNUSABLE_PROFILES,
  useGeminiRig,
  world,
  writeCache,
  writeLedger,
  writeLedgerRaw
} from './sparkleGeminiProbeRig'

const TW1 = NODES[0]
const TW2 = NODES[1]
const JP1 = NODES[2]
const ALL_NAMES = ['台湾-1', '台湾-2', '日本-1']

function manyNodes(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({
    name: `节点-${String(index + 1).padStart(2, '0')}`,
    type: 'ss',
    server: `s${index}.example.com`,
    port: 443
  }))
}

describe('sparkleGeminiProviderSync gating', () => {
  useGeminiRig()

  it('writes nothing when the profile has no nodes', async () => {
    world.profileProxies = []

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.equal(readGeminiProviderOrder(), undefined)
    assert.deepEqual(world.calls, [])
  })

  for (const [label, apply] of UNUSABLE_PROFILES) {
    it(`writes nothing when the ${label}`, async () => {
      apply()

      await providerSync().rebuildAndReloadGeminiProvider()

      assert.equal(readGeminiProviderOrder(), undefined)
      assert.deepEqual(world.calls, [])
      assert.deepEqual(world.logs, [])
    })
  }

  it('writes the file but reloads nothing while mihomo does not know the provider yet', async () => {
    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(readGeminiProviderOrder(), ALL_NAMES)
    assert.deepEqual(world.calls, [])
    assert.deepEqual(world.logs, [])
  })

  it('neither rewrites nor reloads when only the order changed', async () => {
    world.geminiProvider = ['日本-1', '台湾-2', '台湾-1']

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.equal(readGeminiProviderOrder(), undefined)
    assert.deepEqual(world.calls, [])
  })

  it('rewrites and reloads when the members change', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(true) })
    world.geminiProvider = ALL_NAMES

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(readGeminiProviderOrder(), ['台湾-1'])
    assert.deepEqual(callsStarting('update:'), ['update:gemini专用'])
    assertLog('gemini provider reloaded members=1 stable=0 first=台湾-1 degraded=no-stable-node')
  })

  it('logs a failed reload instead of throwing', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(true) })
    world.geminiProvider = ALL_NAMES
    world.updateFailure = { reason: new Error('reload failed') }

    await providerSync().rebuildAndReloadGeminiProvider()

    assertLog('rebuild gemini provider failed: reload failed')
  })

  it('reports a failure that is not an Error by its text', async () => {
    world.providersFailure = { reason: 'plain failure' }

    await providerSync().rebuildAndReloadGeminiProvider()

    assertLog('rebuild gemini provider failed: plain failure')
  })
})

describe('sparkleGeminiProviderSync stability', () => {
  useGeminiRig()

  const verifiedEverywhere = (): void =>
    writeCache({
      [cacheKey(TW1)]: cacheRecord(true),
      [cacheKey(TW2)]: cacheRecord(true),
      [cacheKey(JP1)]: cacheRecord(true)
    })

  it('puts the stable nodes first and reports how many there are', async () => {
    verifiedEverywhere()
    writeLedger({ '台湾-2': { samples: 10 } })
    world.geminiProvider = ['台湾-1']

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(readGeminiProviderOrder(), ['台湾-2', '台湾-1', '日本-1'])
    assertLog('gemini provider reloaded members=3 stable=1 first=台湾-2')
    assertNoLog('degraded')
  })

  it('does not count a node that was judged restricted recently', async () => {
    verifiedEverywhere()
    writeLedger({ '台湾-2': { samples: 50, lastBadAt: NOW - DAY_MS } })
    world.geminiProvider = ['台湾-1']

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(readGeminiProviderOrder(), ALL_NAMES)
    assertLog('members=3 stable=0 first=台湾-1 degraded=no-stable-node')
  })

  it('treats an unreadable ledger as no history and still builds the provider', async () => {
    verifiedEverywhere()
    writeLedgerRaw('{not json')
    world.geminiProvider = ['台湾-1']

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(readGeminiProviderOrder(), ALL_NAMES)
    assertLog('ledger unreadable, starting empty')
    assertLog('members=3 stable=0 first=台湾-1 degraded=no-stable-node')
  })
})

describe('sparkleGeminiProviderSync evicted connections', () => {
  useGeminiRig()

  it('closes the connections of a node that left the pool because it was judged restricted', async () => {
    writeCache({
      [cacheKey(TW1)]: cacheRecord(false),
      [cacheKey(TW2)]: cacheRecord(true),
      [cacheKey(JP1)]: cacheRecord(true)
    })
    world.geminiProvider = ALL_NAMES

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(world.calls, ['update:gemini专用', 'close:台湾-1:gemini专用'])
    assertLog('closed gemini专用 connections of evicted node "台湾-1"')
  })

  it('leaves the connections of nodes that merely have no verdict', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(true) })
    world.geminiProvider = ALL_NAMES

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(world.calls, ['update:gemini专用'])
  })

  it('leaves the connections of nodes pushed out by the pool size limit', async () => {
    const nodes = manyNodes(14)
    world.profileProxies = nodes
    writeCache(Object.fromEntries(nodes.map((node) => [cacheKey(node), cacheRecord(true)])))
    world.geminiProvider = nodes.map((node) => String(node.name))

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(world.calls, ['update:gemini专用'])
    assert.equal(readGeminiProviderOrder()?.length, 12)
  })

  it('closes only the nodes the provider was actually serving', async () => {
    writeCache({
      [cacheKey(TW1)]: cacheRecord(false),
      [cacheKey(TW2)]: cacheRecord(true),
      [cacheKey(JP1)]: cacheRecord(true)
    })
    world.geminiProvider = ['日本-1']

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(world.calls, ['update:gemini专用'])
  })

  it('closes nothing when the reload itself failed', async () => {
    writeCache({
      [cacheKey(TW1)]: cacheRecord(false),
      [cacheKey(TW2)]: cacheRecord(true),
      [cacheKey(JP1)]: cacheRecord(true)
    })
    world.geminiProvider = ALL_NAMES
    world.updateFailure = { reason: new Error('reload failed') }

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(callsStarting('close:'), [])
    assertLog('rebuild gemini provider failed: reload failed')
  })

  it('keeps going and says so when closing the connections of one node fails', async () => {
    writeCache({
      [cacheKey(TW1)]: cacheRecord(false),
      [cacheKey(TW2)]: cacheRecord(false),
      [cacheKey(JP1)]: cacheRecord(true)
    })
    world.geminiProvider = ALL_NAMES
    world.closeFailure = { reason: new Error('controller busy') }

    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(callsStarting('close:'), [
      'close:台湾-1:gemini专用',
      'close:台湾-2:gemini专用'
    ])
    assertLog('could not close connections of evicted node "台湾-1": controller busy')
    assertLog('could not close connections of evicted node "台湾-2": controller busy')
    assertNoLog('rebuild gemini provider failed')
  })
})
