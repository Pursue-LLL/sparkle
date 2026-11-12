import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { RETRY_DELAY_MS, createRig, elapse } from './managedStreamRig'

describe('managed stream', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] })
  })
  afterEach(() => {
    mock.timers.reset()
  })

  it('opens one socket on the resolved path and delivers text messages', async () => {
    const rig = createRig()
    await rig.stream.start()

    assert.deepEqual(rig.paths, ['/logs?level=info'])
    rig.sockets[0].receive('{"a":1}')
    assert.deepEqual(rig.messages, ['{"a":1}'])
  })

  it('does nothing when started again while connected or connecting', async () => {
    const rig = createRig()
    await rig.stream.start()
    await rig.stream.start()
    assert.equal(rig.sockets.length, 1)

    const pending = createRig()
    let openGate: () => void = () => undefined
    pending.behavior.openGate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    const first = pending.stream.start()
    const second = pending.stream.start()
    openGate()
    await Promise.all([first, second])
    assert.equal(pending.sockets.length, 1)
  })

  it('keeps the stream alive when a message handler throws', async () => {
    const rig = createRig()
    await rig.stream.start()
    rig.behavior.handlerError = new Error('bad payload')
    rig.sockets[0].receive('broken')
    rig.behavior.handlerError = undefined
    rig.sockets[0].receive('fine')

    assert.deepEqual(rig.messages, ['fine'])
  })

  it('reconnects after the delay and resolves the path again', async () => {
    const rig = createRig()
    await rig.stream.start()
    rig.behavior.path = '/logs?level=debug'
    rig.sockets[0].drop()

    await elapse(RETRY_DELAY_MS - 1)
    assert.equal(rig.sockets.length, 1)
    await elapse(1)
    assert.equal(rig.sockets.length, 2)
    assert.deepEqual(rig.paths, ['/logs?level=info', '/logs?level=debug'])
  })

  it('gives up once the retry budget is used up', async () => {
    const rig = createRig({ maxRetries: 2 })
    await rig.stream.start()
    for (let round = 0; round < 3; round += 1) {
      rig.sockets.at(-1)?.drop()
      await elapse(RETRY_DELAY_MS)
    }

    assert.equal(rig.sockets.length, 3)
    await elapse(RETRY_DELAY_MS * 10)
    assert.equal(rig.sockets.length, 3)
  })

  it('restores the whole retry budget when a message arrives', async () => {
    const rig = createRig({ maxRetries: 1 })
    await rig.stream.start()
    rig.sockets[0].drop()
    await elapse(RETRY_DELAY_MS)
    rig.sockets[1].receive('alive')
    rig.sockets[1].drop()
    await elapse(RETRY_DELAY_MS)

    assert.equal(rig.sockets.length, 3)
  })

  it('never runs out of retries when the budget is unlimited', async () => {
    const rig = createRig({ maxRetries: Number.POSITIVE_INFINITY })
    await rig.stream.start()
    for (let round = 0; round < 25; round += 1) {
      rig.sockets.at(-1)?.drop()
      await elapse(RETRY_DELAY_MS)
    }

    assert.equal(rig.sockets.length, 26)
  })

  it('closes the socket on stop and never reconnects afterwards', async () => {
    const rig = createRig()
    await rig.stream.start()
    const socket = rig.sockets[0]
    rig.stream.stop()

    assert.equal(socket.closeCalls, 1)
    socket.drop()
    await elapse(RETRY_DELAY_MS * 10)
    assert.equal(rig.sockets.length, 1)
  })

  it('cancels a pending reconnect on stop', async () => {
    const rig = createRig()
    await rig.stream.start()
    rig.sockets[0].drop()
    rig.stream.stop()

    await elapse(RETRY_DELAY_MS * 10)
    assert.equal(rig.sockets.length, 1)
  })

  it('starts the next run with a fresh retry budget after stop', async () => {
    const rig = createRig({ maxRetries: 1 })
    await rig.stream.start()
    rig.sockets[0].drop()
    await elapse(RETRY_DELAY_MS)
    rig.stream.stop()
    await rig.stream.start()
    rig.sockets.at(-1)?.drop()
    await elapse(RETRY_DELAY_MS)

    assert.equal(rig.sockets.length, 4)
  })

  it('closes the socket when it reports an error', async () => {
    const rig = createRig()
    await rig.stream.start()
    rig.sockets[0].onerror?.()

    assert.equal(rig.sockets[0].closeCalls, 1)
  })

  it('discards a connection that finishes opening after stop', async () => {
    const rig = createRig()
    let openGate: () => void = () => undefined
    rig.behavior.openGate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    const starting = rig.stream.start()
    rig.stream.stop()
    openGate()
    await starting

    assert.equal(rig.sockets.length, 1)
    assert.equal(rig.sockets[0].closeCalls, 1)

    rig.behavior.openGate = undefined
    await rig.stream.start()
    assert.equal(rig.sockets.length, 2)
    assert.equal(rig.sockets[1].closeCalls, 0)
  })

  it('keeps only the newest connection when restarted during setup', async () => {
    const rig = createRig()
    let openGate: () => void = () => undefined
    rig.behavior.openGate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    const first = rig.stream.start()
    const second = rig.stream.restart()
    openGate()
    await Promise.all([first, second])

    assert.equal(rig.sockets.length, 2)
    assert.equal(rig.sockets[0].closeCalls, 1)
    assert.equal(rig.sockets[1].closeCalls, 0)
  })

  it('restart closes the current connection and opens a new one', async () => {
    const rig = createRig()
    await rig.stream.start()
    await rig.stream.restart()

    assert.equal(rig.sockets[0].closeCalls, 1)
    assert.equal(rig.sockets.length, 2)
  })
})
