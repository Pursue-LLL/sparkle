import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertLog,
  assertNoLog,
  cacheKey,
  cacheRecord,
  callsStarting,
  DAY_MS,
  manyNodes,
  NODES,
  NOW,
  providerSync,
  settle,
  UNUSABLE_PROFILES,
  useGeminiRig,
  world
} from './sparkleGeminiProbeRig'
import {
  readGeminiProviderOrder,
  writeCache,
  writeLedger,
  writeLedgerRaw
} from './sparkleGeminiFilesHarness'

const TW1 = NODES[0]
const TW2 = NODES[1]
const JP1 = NODES[2]
const ALL_NAMES = ['台湾-1', '台湾-2', '日本-1']

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

describe('sparkleGeminiProviderSync serialization', () => {
  useGeminiRig()

  it('lets a rebuild start only after the one before it has finished', async () => {
    let reading = false
    let release: () => void = () => undefined
    world.onProvidersRead = () =>
      new Promise<void>((resolve) => {
        reading = true
        release = resolve
      })

    const first = providerSync().rebuildAndReloadGeminiProvider()
    const second = providerSync().rebuildAndReloadGeminiProvider()
    await settle()

    assert.ok(reading, 'the first rebuild is waiting on the controller')
    assert.equal(world.profileReads, 1, 'the second rebuild has not started')

    world.onProvidersRead = undefined
    release()
    await Promise.all([first, second])

    assert.equal(world.profileReads, 2)
  })

  it('is not blocked for good by a rebuild that failed outright', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(true) })
    world.geminiProvider = ALL_NAMES
    world.providersFailure = { reason: new Error('controller down') }
    world.logFails = true
    await assert.rejects(providerSync().rebuildAndReloadGeminiProvider(), /disk full/)

    world.providersFailure = undefined
    world.logFails = false
    await providerSync().rebuildAndReloadGeminiProvider()

    assert.deepEqual(callsStarting('update:'), ['update:gemini专用'])
  })
})
