import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  assertLog,
  callsStarting,
  readOrder,
  samplesFor,
  tickRefresh,
  useFastOrderRig,
  world,
  writeSnapshot
} from './sparkleFastLatencyOrderRig'

const PROVIDER = 'sparkle-fast'
const FILE_ORDER = ['台湾-1', '台湾-2', '日本-1', '美国-1']

describe('sparkleFastLatencyOrder periodic recheck', () => {
  const fast = useFastOrderRig()

  it('adopts a clearly faster first node, refills the samples and then settles', async () => {
    world.providerProxies = samplesFor({ '台湾-1': 400, '台湾-2': 100, '日本-1': 80, '美国-1': 50 })
    fast.startLoop()

    await tickRefresh()
    assert.deepEqual(readOrder(), ['台湾-2', '台湾-1', '日本-1', '美国-1'])
    assert.deepEqual(world.calls, [`update:${PROVIDER}`, `probe:${PROVIDER}`])

    await tickRefresh()
    assert.deepEqual(world.calls, [`update:${PROVIDER}`, `probe:${PROVIDER}`], 'nothing left to do')
  })

  it('falls back to the saved snapshot when mihomo has no samples, e.g. after a provider reload', async () => {
    writeSnapshot({ '台湾-1': 200, '台湾-2': 100, '日本-1': 80, '美国-1': 50 })
    fast.startLoop()

    await tickRefresh()

    assert.deepEqual(readOrder(), ['台湾-2', '台湾-1', '日本-1', '美国-1'])
    assert.deepEqual(world.calls, [`update:${PROVIDER}`, `probe:${PROVIDER}`])
  })

  it('keeps the current first node when the gain is within the noise', async () => {
    world.providerProxies = samplesFor({ '台湾-1': 100, '台湾-2': 80, '日本-1': 80, '美国-1': 50 })
    fast.startLoop()

    await tickRefresh()

    assert.deepEqual(readOrder(), FILE_ORDER)
    assert.deepEqual(world.calls, [])
  })

  it('replaces a first node that has no live sample any more', async () => {
    world.providerProxies = samplesFor({
      '台湾-1': undefined,
      '台湾-2': 120,
      '日本-1': 80,
      '美国-1': 50
    })
    fast.startLoop()

    await tickRefresh()

    assert.deepEqual(readOrder(), ['台湾-2', '日本-1', '美国-1', '台湾-1'])
  })

  it('never releases the pin, even when the pinned node is gone', async () => {
    world.providerProxies = samplesFor({ '台湾-1': 400, '台湾-2': 100, '日本-1': 80, '美国-1': 50 })
    world.pinned = '台湾-9'
    fast.startLoop()

    await tickRefresh()

    assert.deepEqual(callsStarting('unfix:'), [])
    assert.deepEqual(callsStarting('detail:'), [])
  })

  it('does nothing while there are no samples at all', async () => {
    fast.startLoop()

    await tickRefresh()

    assert.deepEqual(world.calls, [])
    assertLog('skipped, no probe samples yet')
  })

  it('logs a refill that fails and keeps going', async () => {
    world.providerProxies = samplesFor({ '台湾-1': 400, '台湾-2': 100, '日本-1': 80, '美国-1': 50 })
    world.probeFailure = { reason: new Error('refill boom') }
    fast.startLoop()

    await tickRefresh()

    assert.deepEqual(readOrder(), ['台湾-2', '台湾-1', '日本-1', '美国-1'])
    assertLog('refill failed: refill boom')
  })

  it('skips a round quietly when the controller is unreachable', async () => {
    world.providersError = new Error('controller down')
    fast.startLoop()

    await tickRefresh()

    assert.deepEqual(world.calls, [])
    assert.deepEqual(world.logs, [])
  })

  it('registers one timer however often it is asked to start', () => {
    const setIntervalSpy = mock.method(globalThis, 'setInterval')
    try {
      fast.startLoop()
      fast.startLoop()

      assert.equal(setIntervalSpy.mock.callCount(), 1)
    } finally {
      setIntervalSpy.mock.restore()
    }
  })

  it('does not keep the process alive just to recheck', () => {
    const realSetInterval = globalThis.setInterval
    let unrefCalls = 0
    const setIntervalSpy = mock.method(globalThis, 'setInterval', ((
      ...args: Parameters<typeof setInterval>
    ) => {
      const timer = realSetInterval(...args)
      mock.method(timer, 'unref', () => {
        unrefCalls += 1
        return timer
      })
      return timer
    }) as typeof setInterval)
    try {
      fast.startLoop()

      assert.equal(unrefCalls, 1)
    } finally {
      setIntervalSpy.mock.restore()
    }
  })
})
