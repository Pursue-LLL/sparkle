import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import {
  AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
  AUTO_SELECT_GEMINI_PROBE_URL
} from './defaultAutoSwitchProxy'
import { flush } from './groupFailoverEngineHarness'
import type * as LeafProbe from './providerLeafProbe'

type Leaf = Record<string, unknown>
interface ProviderEntry {
  vehicleType?: string
  proxies?: Leaf[]
}

const NOW = 1_700_000_000_000
const ISO = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString()

const world = {
  providers: {} as Record<string, ProviderEntry>,
  delayError: undefined as undefined | ((name: string) => Error | undefined),
  onProbe: undefined as undefined | ((name: string) => void),
  probes: [] as string[],
  inFlight: 0,
  maxInFlight: 0,
  logs: [] as string[]
}

/** 最近一次探测成功 / 失败 / 没测过的节点（组探测地址上的记录）。 */
const okLeaf = (name: string): Leaf => ({
  name,
  extra: {
    [AUTO_SELECT_GEMINI_PROBE_URL]: { alive: true, history: [{ time: ISO(0), delay: 120 }] }
  }
})
const failedLeaf = (name: string): Leaf => ({
  name,
  extra: { [AUTO_SELECT_GEMINI_PROBE_URL]: { alive: false, history: [{ time: ISO(0), delay: 0 }] } }
})
const untestedLeaf = (name: string): Leaf => ({ name })

const manyLeaves = (count: number): Leaf[] =>
  Array.from({ length: count }, (_, index) => failedLeaf(`node-${index}`))

describe('providerLeafProbe', () => {
  let probe: typeof LeafProbe

  before(() => {
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          world.logs.push(line)
        }
      }
    })
    mock.module('./mihomoApi', {
      exports: {
        mihomoProxyProviders: async (): Promise<unknown> => ({ providers: world.providers }),
        mihomoProviderLeafDelay: async (
          provider: string,
          name: string,
          url: string,
          timeoutMs: number
        ): Promise<void> => {
          world.probes.push(`${provider}/${name}|${url}|${timeoutMs}`)
          world.inFlight += 1
          world.maxInFlight = Math.max(world.maxInFlight, world.inFlight)
          try {
            world.onProbe?.(name)
            await flush()
            const error = world.delayError?.(name)
            if (error) {
              throw error
            }
          } finally {
            world.inFlight -= 1
          }
        }
      }
    })
    probe = require('./providerLeafProbe') as typeof LeafProbe
  })

  beforeEach(() => {
    world.providers = {}
    world.delayError = undefined
    world.onProbe = undefined
    world.probes = []
    world.inFlight = 0
    world.maxInFlight = 0
    world.logs = []
  })

  afterEach(() => {
    mock.timers.reset()
  })

  describe('probeProviderLeavesGently', () => {
    it('probes every node of the provider on the Gemini target and counts them', async () => {
      world.providers = { 'sparkle-fast': { proxies: [okLeaf('a'), failedLeaf('b')] } }

      assert.equal(await probe.probeProviderLeavesGently('sparkle-fast'), 2)

      const target = `${AUTO_SELECT_GEMINI_PROBE_URL}|${AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS}`
      assert.deepEqual(world.probes.sort(), [
        `sparkle-fast/a|${target}`,
        `sparkle-fast/b|${target}`
      ])
    })

    it('never has more than four probes in flight', async () => {
      world.providers = { 'sparkle-fast': { proxies: manyLeaves(10) } }

      assert.equal(await probe.probeProviderLeavesGently('sparkle-fast'), 10)

      assert.equal(world.probes.length, 10)
      assert.equal(world.maxInFlight, 4)
    })

    it('goes on with the other nodes when one probe fails', async () => {
      world.providers = { 'sparkle-fast': { proxies: manyLeaves(6) } }
      world.delayError = (name) => (name === 'node-1' ? new Error('timeout') : undefined)

      assert.equal(await probe.probeProviderLeavesGently('sparkle-fast'), 6)

      assert.equal(world.probes.length, 6)
    })

    it('does nothing for a provider mihomo does not know, or one without nodes', async () => {
      world.providers = { empty: {} }

      assert.equal(await probe.probeProviderLeavesGently('missing'), 0)
      assert.equal(await probe.probeProviderLeavesGently('empty'), 0)

      assert.deepEqual(world.probes, [])
    })
  })

  describe('verifyUnconfirmedFailures', () => {
    it('re-probes only the nodes whose latest sample is not a success', async () => {
      world.providers = {
        'sparkle-fast': { vehicleType: 'File', proxies: [okLeaf('ok'), failedLeaf('failed')] },
        subscription: { vehicleType: 'HTTP', proxies: [untestedLeaf('fresh'), okLeaf('fine')] }
      }

      assert.equal(await probe.verifyUnconfirmedFailures(), 2)

      assert.deepEqual(world.probes.map((entry) => entry.split('|')[0]).sort(), [
        'sparkle-fast/failed',
        'subscription/fresh'
      ])
      assert.deepEqual(world.logs, [
        '[ProviderLeafProbe]: verified unconfirmed failures probed=2\n'
      ])
    })

    it('skips providers that only wrap a group’s inline nodes', async () => {
      world.providers = {
        inline: { vehicleType: 'Compatible', proxies: [failedLeaf('x')] },
        real: { vehicleType: 'HTTP', proxies: [failedLeaf('y')] }
      }

      assert.equal(await probe.verifyUnconfirmedFailures(), 1)

      assert.deepEqual(
        world.probes.map((entry) => entry.split('|')[0]),
        ['real/y']
      )
    })

    it('copes with providers that list no nodes', async () => {
      world.providers = { empty: { vehicleType: 'HTTP' } }

      assert.equal(await probe.verifyUnconfirmedFailures(), 0)

      assert.deepEqual(world.logs, [
        '[ProviderLeafProbe]: verified unconfirmed failures probed=0\n'
      ])
    })

    it('stops probing once its time budget is spent and counts only what it probed', async () => {
      mock.timers.enable({ apis: ['Date'], now: NOW })
      world.providers = { slow: { vehicleType: 'HTTP', proxies: manyLeaves(8) } }
      // 第一个探测一发出，预算就耗尽：排在后面还没开始的节点都不再探测
      world.onProbe = () => mock.timers.tick(151_000)

      const probed = await probe.verifyUnconfirmedFailures()

      assert.equal(world.probes.length, 1)
      assert.equal(probed, 1)
      assert.deepEqual(world.logs, [
        '[ProviderLeafProbe]: verified unconfirmed failures probed=1\n'
      ])
    })
  })
})
