import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import WebSocket from 'ws'
import { createManagedStream, type ManagedStreamOptions } from './managedStream'

const RETRY_DELAY_MS = 1000

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/** 只实现数据流用到的那部分 ws.WebSocket；`on*` 与 EventEmitter 监听同属一套，removeAllListeners 一并清掉。 */
class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closeCalls = 0

  close(): void {
    this.closeCalls += 1
    this.readyState = WebSocket.CLOSING
  }

  override removeAllListeners(): this {
    this.onmessage = null
    this.onclose = null
    this.onerror = null
    return super.removeAllListeners()
  }

  receive(data: string): void {
    this.onmessage?.({ data })
  }

  /** 对端断开：连接进入 CLOSED 并触发 close 事件。 */
  drop(): void {
    this.readyState = WebSocket.CLOSED
    this.onclose?.()
  }
}

interface Rig {
  stream: ReturnType<typeof createManagedStream>
  sockets: FakeSocket[]
  paths: string[]
  messages: string[]
  behavior: {
    path: string
    openError: Error | undefined
    resolveError: Error | undefined
    openGate: Promise<void> | undefined
    handlerError: Error | undefined
  }
}

function createRig(options: Partial<ManagedStreamOptions> = {}): Rig {
  const sockets: FakeSocket[] = []
  const paths: string[] = []
  const messages: string[] = []
  const behavior: Rig['behavior'] = {
    path: '/logs?level=info',
    openError: undefined,
    resolveError: undefined,
    openGate: undefined,
    handlerError: undefined
  }
  const stream = createManagedStream({
    resolvePath: async () => {
      if (behavior.resolveError) {
        throw behavior.resolveError
      }
      return behavior.path
    },
    openSocket: async (path) => {
      paths.push(path)
      await behavior.openGate
      if (behavior.openError) {
        throw behavior.openError
      }
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    onMessage: (payload) => {
      if (behavior.handlerError) {
        throw behavior.handlerError
      }
      messages.push(payload)
    },
    retryDelayMs: RETRY_DELAY_MS,
    ...options
  })
  return { stream, sockets, paths, messages, behavior }
}

/** 按重连间隔分步推进假时钟：每步之后等异步连接流程跑完，失败后新排的重连才能在下一步触发。 */
async function elapse(ms: number): Promise<void> {
  for (let remaining = ms; remaining > 0; remaining -= RETRY_DELAY_MS) {
    mock.timers.tick(Math.min(remaining, RETRY_DELAY_MS))
    await flush()
  }
}

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
})
