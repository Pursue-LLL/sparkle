import { EventEmitter } from 'node:events'
import { mock } from 'node:test'
import WebSocket from 'ws'
import { createManagedStream, type ManagedStreamOptions } from './managedStream'

export const RETRY_DELAY_MS = 1000

export function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/** 只实现数据流用到的那部分 ws.WebSocket；`on*` 与 EventEmitter 监听同属一套，removeAllListeners 一并清掉。 */
export class FakeSocket extends EventEmitter {
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

export interface Rig {
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

export function createRig(options: Partial<ManagedStreamOptions> = {}): Rig {
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
export async function elapse(ms: number): Promise<void> {
  for (let remaining = ms; remaining > 0; remaining -= RETRY_DELAY_MS) {
    mock.timers.tick(Math.min(remaining, RETRY_DELAY_MS))
    await flush()
  }
}
