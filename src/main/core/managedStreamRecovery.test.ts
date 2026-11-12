import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { RETRY_DELAY_MS, createRig, elapse } from './managedStreamRig'

describe('managed stream: failures and recovery', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] })
  })
  afterEach(() => {
    mock.timers.reset()
  })

  it('reports a failed first connection and still retries it', async () => {
    const rig = createRig()
    rig.behavior.openError = new Error('service api not ready')
    await assert.rejects(rig.stream.start(), /service api not ready/)

    rig.behavior.openError = undefined
    await elapse(RETRY_DELAY_MS)
    assert.equal(rig.sockets.length, 1)
    rig.sockets[0].receive('up')
    assert.deepEqual(rig.messages, ['up'])
  })

  it('keeps retrying failed reconnects until the budget is used up', async () => {
    const rig = createRig({ maxRetries: 3 })
    await rig.stream.start()
    rig.behavior.openError = new Error('service api not ready')
    rig.sockets[0].drop()
    await elapse(RETRY_DELAY_MS * 10)

    assert.equal(rig.paths.length, 4)
    rig.behavior.openError = undefined
    await elapse(RETRY_DELAY_MS * 10)
    assert.equal(rig.sockets.length, 1)
  })

  it('treats a path that cannot be resolved like a failed connection', async () => {
    const rig = createRig({ maxRetries: Number.POSITIVE_INFINITY })
    rig.behavior.resolveError = new Error('config unreadable')
    await assert.rejects(rig.stream.start(), /config unreadable/)

    rig.behavior.resolveError = undefined
    await elapse(RETRY_DELAY_MS)
    assert.equal(rig.sockets.length, 1)
  })

  it('does not retry a failed setup that stop has already cancelled', async () => {
    const rig = createRig()
    let rejectOpen: (error: Error) => void = () => undefined
    rig.behavior.openGate = new Promise<void>((_, reject) => {
      rejectOpen = reject
    })
    const starting = rig.stream.start()
    rig.stream.stop()
    rejectOpen(new Error('late failure'))
    await assert.rejects(starting, /late failure/)

    rig.behavior.openGate = undefined
    await elapse(RETRY_DELAY_MS * 10)
    assert.equal(rig.sockets.length, 0)
  })

  it('retries ten times, one second apart, unless told otherwise', async () => {
    const rig = createRig({ retryDelayMs: undefined })
    await rig.stream.start()
    for (let round = 0; round < 11; round += 1) {
      rig.sockets.at(-1)?.drop()
      await elapse(1000)
    }

    assert.equal(rig.sockets.length, 11)
    await elapse(10_000)
    assert.equal(rig.sockets.length, 11)
  })

  it('swallows errors from a connection it has already let go of', async () => {
    const rig = createRig()
    await rig.stream.start()
    const socket = rig.sockets[0]
    rig.stream.stop()

    assert.doesNotThrow(() => socket.emit('error', new Error('late socket error')))
  })

  it('reconnects after a restart even if a reconnect was pending when it was stopped', async () => {
    const rig = createRig()
    await rig.stream.start()
    rig.sockets[0].drop()
    rig.stream.stop()
    await rig.stream.start()
    rig.sockets.at(-1)?.drop()
    await elapse(RETRY_DELAY_MS)

    assert.equal(rig.sockets.length, 3)
  })

  it('does not open a second connection when started while a reconnect is pending', async () => {
    const rig = createRig()
    await rig.stream.start()
    rig.sockets[0].drop()
    await rig.stream.start()
    assert.equal(rig.sockets.length, 2)

    await elapse(RETRY_DELAY_MS * 3)
    assert.equal(rig.sockets.length, 2)
  })

  it('can be started again after a dropped connection used up the budget', async () => {
    const rig = createRig({ maxRetries: 0 })
    await rig.stream.start()
    rig.sockets[0].drop()
    await elapse(RETRY_DELAY_MS * 3)
    assert.equal(rig.sockets.length, 1)

    await rig.stream.start()
    assert.equal(rig.sockets.length, 2)
  })

  it('can be started again after a failed attempt used up the budget', async () => {
    const rig = createRig({ maxRetries: 0 })
    rig.behavior.openError = new Error('service api not ready')
    await assert.rejects(rig.stream.start(), /service api not ready/)

    rig.behavior.openError = undefined
    await rig.stream.start()
    assert.equal(rig.sockets.length, 1)
  })
})
