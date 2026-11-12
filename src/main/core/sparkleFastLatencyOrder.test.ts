import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import { buildProviderFingerprint } from './sparkleFastDelaySnapshotCore'
import {
  assertLog,
  callsStarting,
  NODES,
  readOrder,
  readSnapshot,
  removeNodes,
  samplesFor,
  useFastOrderRig,
  world,
  writeNodes,
  writeSnapshot
} from './sparkleFastLatencyOrderRig'

const PROVIDER = 'sparkle-fast'
const FILE_ORDER = ['台湾-1', '台湾-2', '日本-1', '美国-1']
/** 台湾-2 比 台湾-1 快得多，其余地区不动：延迟序与文件序不同。 */
const FASTER_SECOND = { '台湾-1': 200, '台湾-2': 100, '日本-1': 80, '美国-1': 50 }
/** 文件序已经是延迟序。 */
const ALREADY_ORDERED = { '台湾-1': 100, '台湾-2': 200, '日本-1': 80, '美国-1': 50 }

describe('sparkleFastLatencyOrder bootstrap', () => {
  const fast = useFastOrderRig()

  describe('with enough samples in memory', () => {
    it('reorders the provider file by latency, tells mihomo and refills the samples', async () => {
      world.providerProxies = samplesFor(FASTER_SECOND)

      await fast.bootstrap()

      assert.deepEqual(readOrder(), ['台湾-2', '台湾-1', '日本-1', '美国-1'])
      assert.deepEqual(world.calls, [
        `update:${PROVIDER}`,
        `detail:${AUTO_SELECT_GROUP_NAME}`,
        `probe:${PROVIDER}`
      ])
      assertLog('reordered by latency nodes=4 sampled=4 first=台湾-2')
      assertLog('refilled probe samples after reorder')
    })

    it('saves the measured delays as a version 2 snapshot', async () => {
      world.providerProxies = samplesFor(FASTER_SECOND)

      await fast.bootstrap()

      assert.deepEqual(readSnapshot(), {
        version: 2,
        providerFingerprint: buildProviderFingerprint(NODES),
        samples: FASTER_SECOND
      })
    })

    it('leaves the file alone when it is already in latency order, but still checks the pin', async () => {
      world.providerProxies = samplesFor(ALREADY_ORDERED)

      await fast.bootstrap()

      assert.deepEqual(readOrder(), FILE_ORDER)
      assert.deepEqual(world.calls, [`detail:${AUTO_SELECT_GROUP_NAME}`])
      assert.ok(!world.logs.some((line) => line.includes('reordered')))
    })

    it('does not probe when four of five nodes already have samples', async () => {
      const five = [
        ...NODES,
        { name: '新加坡-1', type: 'ss', server: 'sg1.example.com', port: 443 }
      ]
      writeNodes(five)
      world.providerProxies = samplesFor({ ...ALREADY_ORDERED, '新加坡-1': undefined })

      await fast.bootstrap()

      assert.deepEqual(callsStarting('probe:'), [])
      assert.ok(!world.logs.some((line) => line.includes('insufficient')))
    })

    it('releases the pin when the pinned node has no live sample', async () => {
      world.providerProxies = samplesFor(FASTER_SECOND)
      world.pinned = '台湾-9'

      await fast.bootstrap()

      assert.deepEqual(callsStarting('unfix:'), [`unfix:${AUTO_SELECT_GROUP_NAME}`])
    })

    it('keeps the pin on a node that is alive', async () => {
      world.providerProxies = samplesFor(FASTER_SECOND)
      world.pinned = '台湾-2'

      await fast.bootstrap()

      assert.deepEqual(callsStarting('unfix:'), [])
    })

    it('releases the pin when the group cannot be read', async () => {
      world.providerProxies = samplesFor(FASTER_SECOND)
      world.groupError = true

      await fast.bootstrap()

      assert.deepEqual(callsStarting('unfix:'), [`unfix:${AUTO_SELECT_GROUP_NAME}`])
    })

    it('leaves out nodes already found to be region locked', async () => {
      world.providerProxies = samplesFor(FASTER_SECOND)
      world.blocked = new Set(['台湾-2'])

      await fast.bootstrap()

      assert.deepEqual(readOrder(), ['台湾-1', '日本-1', '美国-1'])
      assertLog('reordered by latency nodes=3 sampled=4 first=台湾-1')
    })

    it('follows the region priority from the app config', async () => {
      world.providerProxies = samplesFor(FASTER_SECOND)
      world.appConfig = { proxySwitchPriority: ['美国', '日本'] }

      await fast.bootstrap()

      assert.deepEqual(readOrder(), ['美国-1', '日本-1', '台湾-2', '台湾-1'])
    })
  })

  describe('when the provider file lists few or no nodes', () => {
    it('takes the node list from mihomo when the file has none, and does not probe for it', async () => {
      writeNodes([])
      world.providerProxies = samplesFor(FASTER_SECOND)

      await fast.bootstrap()

      assert.deepEqual(world.calls, [`detail:${AUTO_SELECT_GROUP_NAME}`])
      assert.deepEqual(readSnapshot(), {
        version: 2,
        providerFingerprint: buildProviderFingerprint(world.providerProxies),
        samples: FASTER_SECOND
      })
    })

    it('judges coverage and the snapshot by the file, even when it lists a single node', async () => {
      writeNodes([NODES[0]])
      world.providerProxies = samplesFor({ '台湾-1': 120, '台湾-2': undefined })

      await fast.bootstrap()

      assert.deepEqual(world.calls, [`detail:${AUTO_SELECT_GROUP_NAME}`])
      assert.deepEqual(readSnapshot(), {
        version: 2,
        providerFingerprint: buildProviderFingerprint([NODES[0]]),
        samples: { '台湾-1': 120 }
      })
    })

    it('fails loudly when the provider file is missing, for the caller to isolate', async () => {
      removeNodes()

      await assert.rejects(fast.bootstrap(), { code: 'ENOENT' })
    })
  })

  describe('with the samples only on disk', () => {
    it('uses a snapshot that matches the nodes and covers enough of them, without probing', async () => {
      writeSnapshot(FASTER_SECOND)

      await fast.bootstrap()

      assert.deepEqual(world.calls, [`detail:${AUTO_SELECT_GROUP_NAME}`])
      assert.deepEqual(readOrder(), FILE_ORDER)
      assertLog('bootstrap using disk snapshot samples=4 covered=4/4')
    })

    it('releases a pin that the snapshot does not know as alive', async () => {
      writeSnapshot(FASTER_SECOND)
      world.pinned = '台湾-9'

      await fast.bootstrap()

      assert.deepEqual(callsStarting('unfix:'), [`unfix:${AUTO_SELECT_GROUP_NAME}`])
    })

    it('does not trust a snapshot made for other node settings', async () => {
      writeSnapshot(FASTER_SECOND, [
        { ...NODES[0], server: 'moved.example.com' },
        ...NODES.slice(1)
      ])

      await fast.bootstrap()

      assert.deepEqual(callsStarting('probe:'), [`probe:${PROVIDER}`])
      assertLog('bootstrap samples insufficient memory=0 disk=0 covered=0/4 action=probe')
    })

    it('does not trust a snapshot that covers too few nodes', async () => {
      writeSnapshot({ '台湾-1': 100, '台湾-2': 200 })

      await fast.bootstrap()

      assert.deepEqual(callsStarting('probe:'), [`probe:${PROVIDER}`])
      assertLog('bootstrap samples insufficient memory=0 disk=2 covered=2/4 action=probe')
    })
  })

  describe('with no usable samples', () => {
    it('probes the nodes one by one first, then reorders by what it learned', async () => {
      world.onProbe = () => {
        world.providerProxies = samplesFor(FASTER_SECOND)
      }

      await fast.bootstrap()

      assert.deepEqual(world.calls, [
        `probe:${PROVIDER}`,
        `update:${PROVIDER}`,
        `detail:${AUTO_SELECT_GROUP_NAME}`,
        `probe:${PROVIDER}`
      ])
      assert.deepEqual(readOrder(), ['台湾-2', '台湾-1', '日本-1', '美国-1'])
      assertLog('bootstrap samples insufficient memory=0 disk=0 covered=0/4 action=probe')
      assertLog('probe complete memory_before=0/4')
    })

    it('carries on and gives up quietly when probing fails and nothing was learned', async () => {
      world.probeFailure = { reason: new Error('boom') }

      await fast.bootstrap()

      assert.deepEqual(world.calls, [`probe:${PROVIDER}`])
      assert.deepEqual(readOrder(), FILE_ORDER)
      assertLog('probe failed: boom')
      assertLog('probe complete memory_before=0/4')
      assertLog('skipped, no probe samples yet')
    })

    it('reports a failure that is not an Error by its text', async () => {
      world.probeFailure = { reason: 'plain failure' }

      await fast.bootstrap()

      assertLog('probe failed: plain failure')
    })

    it('does not refill when reordering was not needed', async () => {
      world.onProbe = () => {
        world.providerProxies = samplesFor(ALREADY_ORDERED)
      }

      await fast.bootstrap()

      assert.deepEqual(world.calls, [`probe:${PROVIDER}`, `detail:${AUTO_SELECT_GROUP_NAME}`])
    })
  })

  describe('refilling after a reorder', () => {
    it('logs a refill that fails and still finishes', async () => {
      world.providerProxies = samplesFor(FASTER_SECOND)
      world.probeFailure = { reason: new Error('refill boom') }

      await fast.bootstrap()

      assert.deepEqual(readOrder(), ['台湾-2', '台湾-1', '日本-1', '美国-1'])
      assertLog('refill failed: refill boom')
    })

    it('reports a refill failure that is not an Error by its text', async () => {
      world.providerProxies = samplesFor(FASTER_SECOND)
      world.probeFailure = { reason: 'plain refill failure' }

      await fast.bootstrap()

      assertLog('refill failed: plain refill failure')
    })
  })

  describe('loadSparkleFastDelaySnapshot', () => {
    it('returns the samples saved for the same nodes', async () => {
      writeSnapshot(FASTER_SECOND)

      assert.deepEqual([...(await fast.loadSnapshot(NODES))], Object.entries(FASTER_SECOND))
    })

    it('returns nothing when there is no snapshot', async () => {
      assert.equal((await fast.loadSnapshot(NODES)).size, 0)
    })

    it('returns nothing when the node settings changed since', async () => {
      writeSnapshot(FASTER_SECOND)

      assert.equal(
        (await fast.loadSnapshot([{ ...NODES[0], port: 8443 }, ...NODES.slice(1)])).size,
        0
      )
    })
  })
})
