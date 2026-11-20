import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GATE_OPEN } from './dedicatedGroupsRig'
import {
  followProviderReloads,
  headOn,
  inUse,
  restrictNodes,
  tick
} from './sparkleGeminiGuardHarness'
import {
  readCache,
  readGeminiProviderOrder,
  readLedger,
  writeCache
} from './sparkleGeminiFilesHarness'
import {
  assertLog,
  cacheKey,
  cacheRecord,
  callsStarting,
  guard,
  HOUR_MS,
  manyNodes,
  NODES,
  NOW,
  settle,
  useGeminiRig,
  world
} from './sparkleGeminiProbeRig'

const TW1 = NODES[0]
const TW2 = NODES[1]
const JP1 = NODES[2]
/** 合格判定已经很旧、但还没过期：守护会在它当队首时复验。 */
const STALE_MS = 11 * HOUR_MS

const probes = (): string[] => callsStarting('lock:')

/** mihomo 此刻在 `gemini专用` 里服务这些节点，队首是第一个；重载之后跟着新文件走。 */
function serve(names: string[]): void {
  world.geminiProvider = names
  headOn(names[0], names)
  followProviderReloads()
  guard().startSparkleGeminiCurrentNodeGuardLoop(GATE_OPEN)
}

describe('sparkleGeminiCurrentNodeGuard verdicts', () => {
  useGeminiRig()

  it('swaps a head that Google now rejects out of the provider and closes its connections', async () => {
    writeCache({
      [cacheKey(JP1)]: cacheRecord(true, 'JP', STALE_MS),
      [cacheKey(TW1)]: cacheRecord(true),
      [cacheKey(TW2)]: cacheRecord(true)
    })
    restrictNodes('日本-1')
    serve(['日本-1', '台湾-1', '台湾-2'])

    await tick()

    assert.deepEqual(readGeminiProviderOrder(), ['台湾-1', '台湾-2'])
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-fast', 'update:gemini专用'])
    assert.deepEqual(callsStarting('close:'), ['close:日本-1:gemini专用'])
    assert.deepEqual(probes(), ['lock:日本-1'], 'the new head already has a fresh verdict')
    assertLog('evicted region-restricted node "日本-1" (region=ZZ)')
    assert.equal(readLedger()['日本-1'].lastBadAt, Date.now())
  })

  it('keeps a head that is still eligible, and records the fresh verdict', async () => {
    writeCache({ [cacheKey(JP1)]: cacheRecord(true, 'JP', STALE_MS) })
    restrictNodes()
    serve(['日本-1', '台湾-1'])

    await tick()

    assert.deepEqual(callsStarting('update:'), [])
    assert.equal(readGeminiProviderOrder(), undefined)
    assert.equal(readCache()[cacheKey(JP1)].checkedAt, Date.now())
  })

  it('takes an inconclusive probe for no news', async () => {
    writeCache({ [cacheKey(JP1)]: cacheRecord(true, 'JP', STALE_MS) })
    serve(['日本-1', '台湾-1'])

    await tick()

    assert.deepEqual(probes(), ['lock:日本-1'])
    assert.deepEqual(callsStarting('update:'), [])
    assert.deepEqual(world.logs, [])
    assert.equal(readCache()[cacheKey(JP1)].checkedAt, NOW - STALE_MS)
  })

  it('does not take a probe channel failure for a restricted node', async () => {
    writeCache({ [cacheKey(JP1)]: cacheRecord(true, 'JP', STALE_MS) })
    world.probeFailure = { reason: new Error('listener down') }
    serve(['日本-1', '台湾-1'])

    await tick()

    assert.deepEqual(callsStarting('update:'), [])
    assert.deepEqual(world.logs, [])
    assert.equal(readCache()[cacheKey(JP1)].checkedAt, NOW - STALE_MS)
  })
})

describe('sparkleGeminiCurrentNodeGuard successive heads', () => {
  useGeminiRig()

  it('also verifies the head that takes over from a rejected one', async () => {
    writeCache({
      [cacheKey(JP1)]: cacheRecord(true, 'JP', STALE_MS),
      [cacheKey(TW1)]: cacheRecord(true, 'TW', STALE_MS),
      [cacheKey(TW2)]: cacheRecord(true)
    })
    restrictNodes('日本-1', '台湾-1')
    serve(['日本-1', '台湾-1', '台湾-2'])

    await tick()

    assert.deepEqual(probes(), ['lock:日本-1', 'lock:台湾-1'])
    assert.deepEqual(readGeminiProviderOrder(), ['台湾-2'])
    assert.deepEqual(callsStarting('close:'), [
      'close:日本-1:gemini专用',
      'close:台湾-1:gemini专用'
    ])
  })

  it('looks at no more than three heads in one check', async () => {
    const nodes = manyNodes(5)
    const names = nodes.map((node) => String(node.name))
    world.profileProxies = nodes
    writeCache(
      Object.fromEntries(nodes.map((node) => [cacheKey(node), cacheRecord(true, 'TW', STALE_MS)]))
    )
    restrictNodes(...names)
    serve(names)

    await tick()

    assert.deepEqual(
      probes(),
      names.slice(0, 3).map((name) => `lock:${name}`)
    )
    assert.deepEqual(readGeminiProviderOrder(), names.slice(3))
  })

  it('does not keep verifying a head that cannot be replaced', async () => {
    world.profileProxies = [JP1]
    writeCache({ [cacheKey(JP1)]: cacheRecord(true, 'JP', STALE_MS) })
    restrictNodes('日本-1')
    serve(['日本-1'])

    await tick()

    assert.deepEqual(probes(), ['lock:日本-1'])
    assert.equal(callsStarting('detail:gemini专用').length, 2)
    assert.deepEqual(callsStarting('update:gemini专用'), [])
  })
})

describe('sparkleGeminiCurrentNodeGuard failures', () => {
  useGeminiRig()

  function armed(): void {
    headOn('日本-1')
    restrictNodes()
    guard().startSparkleGeminiCurrentNodeGuardLoop(GATE_OPEN)
  }

  it('ignores a controller resource that no longer exists', async () => {
    armed()
    world.groupFailure = { reason: new Error('Resource not found') }

    await tick()

    assert.deepEqual(world.logs, [])
  })

  it('logs any other failure and checks again next time', async () => {
    armed()
    world.groupFailure = { reason: new Error('controller down') }
    await tick()
    assertLog('[SparkleGeminiGuard]: head check error=controller down')

    world.groupFailure = undefined
    await tick()

    assert.deepEqual(probes(), ['lock:日本-1'])
  })

  it('reports a failure that is not an Error by its text', async () => {
    armed()
    world.groupFailure = { reason: 'plain failure' }

    await tick()

    assertLog('head check error=plain failure')
  })

  it('never runs two checks at once', async () => {
    inUse()
    armed()
    let release: () => void = () => undefined
    world.onProbe = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    await tick()
    await tick()
    assert.deepEqual(probes(), ['lock:日本-1'])

    world.onProbe = undefined
    release()
    await settle()
    await tick()

    assert.equal(probes().length, 2)
  })
})
