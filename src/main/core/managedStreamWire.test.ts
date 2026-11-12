import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, it } from 'node:test'
import WebSocket, { WebSocketServer } from 'ws'
import { createManagedStream, type ManagedStream } from './managedStream'

// 真实 ws 客户端 / 服务端之间的数据流：校验 ws 的事件语义（文本帧为字符串、连接失败时 error 之后必有 close）。
const RETRY_DELAY_MS = 20
const WAIT_LIMIT_MS = 5000

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`)
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })
  }
}

function listen(port = 0): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ port, host: '127.0.0.1' })
    server.once('listening', () => resolve(server))
    server.once('error', reject)
  })
}

function shutdown(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) {
    client.terminate()
  }
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

interface Peer {
  socket: WebSocket
  path: string | undefined
}

function trackConnections(server: WebSocketServer): Peer[] {
  const peers: Peer[] = []
  server.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    peers.push({ socket, path: request.url })
  })
  return peers
}

describe('managed stream over real websockets', () => {
  const cleanups: (() => Promise<void> | void)[] = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup()
    }
  })

  function openStream(
    port: number,
    options: {
      maxRetries?: number
      onOpen?: () => void
      onMessage?: (payload: string) => void
    } = {}
  ): ManagedStream {
    const stream = createManagedStream({
      resolvePath: async () => '/logs?level=warning',
      openSocket: async (path) => {
        options.onOpen?.()
        return new WebSocket(`ws://127.0.0.1:${port}${path}`)
      },
      onMessage: (payload) => options.onMessage?.(payload),
      maxRetries: options.maxRetries,
      retryDelayMs: RETRY_DELAY_MS
    })
    cleanups.push(() => stream.stop())
    return stream
  }

  it('delivers text frames as strings and reconnects after the server drops the client', async () => {
    const server = await listen()
    cleanups.push(() => shutdown(server))
    const peers = trackConnections(server)
    const received: string[] = []
    const { port } = server.address() as AddressInfo
    const stream = openStream(port, { onMessage: (payload) => received.push(payload) })

    await stream.start()
    await waitFor(() => peers.length === 1, 'first connection')
    assert.equal(peers[0].path, '/logs?level=warning')
    peers[0].socket.send('{"type":"warning"}')
    await waitFor(() => received.length === 1, 'first message')
    assert.deepEqual(received, ['{"type":"warning"}'])

    peers[0].socket.terminate()
    await waitFor(() => peers.length === 2, 'reconnection')
    peers[1].socket.send('again')
    await waitFor(() => received.length === 2, 'message after reconnection')
  })

  it('keeps reconnecting while the server is away and resumes once it is back', async () => {
    const first = await listen()
    const { port } = first.address() as AddressInfo
    const attempts = { count: 0 }
    const stream = openStream(port, {
      maxRetries: Number.POSITIVE_INFINITY,
      onOpen: () => {
        attempts.count += 1
      }
    })
    await stream.start()
    await shutdown(first)

    await waitFor(() => attempts.count >= 4, 'several failed attempts')
    const second = await listen(port)
    cleanups.push(() => shutdown(second))
    const peers = trackConnections(second)

    await waitFor(() => peers.length === 1, 'connection to the returned server')
  })

  it('stops reconnecting once the retry budget is used up', async () => {
    const server = await listen()
    const { port } = server.address() as AddressInfo
    const attempts = { count: 0 }
    const stream = openStream(port, {
      maxRetries: 3,
      onOpen: () => {
        attempts.count += 1
      }
    })
    await stream.start()
    await shutdown(server)

    await waitFor(() => attempts.count === 4, 'the last permitted attempt')
    await new Promise<void>((resolve) => {
      setTimeout(resolve, RETRY_DELAY_MS * 10)
    })
    assert.equal(attempts.count, 4)
  })
})
