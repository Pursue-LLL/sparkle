// [INPUT] ws::WebSocket (POS: WebSocket 客户端，仅用其类型与状态常量)
// [OUTPUT] createManagedStream · ManagedStream · ManagedStreamOptions
// [POS] 控制器 WebSocket 数据流的连接生命周期：启停、断线重连与重试额度（有消息到达即重置）。
//       连接如何建立（路径解析 / 套接字工厂）由调用方注入，本层不依赖 Electron，可脱离内核单测。

import WebSocket from 'ws'

const DEFAULT_MAX_RETRIES = 10
const DEFAULT_RETRY_DELAY_MS = 1000

export interface ManagedStreamOptions {
  /** 每次（含重连）重新解析连接路径，使日志级别 / 刷新间隔的变更在重连后生效。 */
  resolvePath: () => Promise<string>
  openSocket: (path: string) => Promise<WebSocket>
  onMessage: (payload: string) => void
  maxRetries?: number
  retryDelayMs?: number
}

export interface ManagedStream {
  /** 已连接或正在连接时无操作。 */
  start: () => Promise<void>
  stop: () => void
  restart: () => Promise<void>
}

function isActive(ws: WebSocket | null): boolean {
  return ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING
}

/** 丢弃不再需要的连接：先摘掉监听，避免它的 close 事件触发重连。 */
function discard(ws: WebSocket): void {
  ws.removeAllListeners()
  ws.on('error', () => {})
  if (isActive(ws)) {
    ws.close()
  }
}

/**
 * 带断线重连的 WebSocket 数据流；有消息到达即重置重试额度，stop 后不再重连。
 * 连接建立失败（路径解析 / 套接字工厂抛错）与连接断开一样消耗重试额度：重连链不能因一次建立失败而悄悄终止。
 */
export function createManagedStream({
  resolvePath,
  openSocket,
  onMessage,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS
}: ManagedStreamOptions): ManagedStream {
  let socket: WebSocket | null = null
  let retriesLeft = maxRetries
  let reconnectTimer: NodeJS.Timeout | null = null
  /** 正在建立的连接；stop / 重启使其作废，建立完成时发现已被取代就直接丢弃，避免遗留无人管理的连接。 */
  let connecting: symbol | null = null

  const clearReconnectTimer = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = (): void => {
    if (socket !== null || !retriesLeft || reconnectTimer) return

    retriesLeft--
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect().catch(() => {})
    }, retryDelayMs)
  }

  const connect = async (): Promise<void> => {
    const attempt = Symbol('connect')
    connecting = attempt

    let ws: WebSocket
    try {
      ws = await openSocket(await resolvePath())
    } catch (error) {
      if (connecting === attempt) {
        connecting = null
        scheduleReconnect()
      }
      throw error
    }
    if (connecting !== attempt) {
      discard(ws)
      return
    }
    connecting = null
    socket = ws

    ws.onmessage = (event): void => {
      retriesLeft = maxRetries
      try {
        onMessage(event.data as string)
      } catch {
        // 单条消息处理失败不影响数据流
      }
    }

    ws.onclose = (): void => {
      if (socket === ws) {
        socket = null
      }
      scheduleReconnect()
    }

    ws.onerror = (): void => {
      ws.close()
    }
  }

  const start = async (): Promise<void> => {
    if (isActive(socket) || connecting) return
    clearReconnectTimer()
    await connect()
  }

  const stop = (): void => {
    retriesLeft = maxRetries
    connecting = null
    clearReconnectTimer()
    if (socket) {
      discard(socket)
      socket = null
    }
  }

  return {
    start,
    stop,
    restart: async (): Promise<void> => {
      stop()
      await start()
    }
  }
}
