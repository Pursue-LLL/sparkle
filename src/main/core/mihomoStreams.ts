// [INPUT] config::getAppConfig/getControledMihomoConfig · utils/dirs::mihomoIpcPath/serviceIpcPath ·
//         service/api::getServiceAuthHeaders · index::mainWindow · resolve/tray · resolve/floatingWindow · utils/log::publishMihomoLog
// [OUTPUT] start/stop MihomoTraffic·Memory·Logs·Connections · restartMihomoLogs/Connections · subscribeMihomoLogs · subscribeMihomoAlerts
// [POS] mihomo 控制器 WebSocket 数据流层。traffic / memory / logs / connections 随界面与内核生命周期启停（断线重连 10 次）；
//       alerts 是故障转移引擎专用的 warning 级日志流：级别固定、不受界面日志级别影响，随订阅者增减启停，断线持续重连。

import WebSocket from 'ws'
import { mainWindow } from '..'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { tray } from '../resolve/tray'
import { floatingWindow } from '../resolve/floatingWindow'
import { getServiceAuthHeaders } from '../service/api'
import { calcTraffic } from '../utils/calc'
import { mihomoIpcPath, serviceIpcPath } from '../utils/dirs'
import { publishMihomoLog } from '../utils/log'

const DEFAULT_MAX_RETRIES = 10
const DEFAULT_RETRY_DELAY_MS = 1000
const ALERTS_RETRY_DELAY_MS = 3000

type MihomoLogListener = (log: ControllerLog) => void

function isWebSocketActive(ws: WebSocket | null): boolean {
  return ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING
}

function closeWebSocket(ws: WebSocket): void {
  ws.removeAllListeners()
  ws.on('error', () => {})
  if (isWebSocketActive(ws)) {
    ws.close()
  }
}

async function openControllerSocket(path: string): Promise<WebSocket> {
  const { corePermissionMode = 'elevated' } = await getAppConfig()
  if (corePermissionMode !== 'service') {
    return new WebSocket(`ws+unix:${mihomoIpcPath()}:${path}`)
  }

  const servicePath = `/core/controller${path}`
  return new WebSocket(`ws+unix:${serviceIpcPath()}:${servicePath}`, {
    headers: getServiceAuthHeaders('GET', servicePath)
  })
}

interface ManagedStreamOptions {
  /** 每次（含重连）重新解析连接路径，使日志级别 / 刷新间隔的变更在重连后生效。 */
  resolvePath: () => Promise<string>
  onMessage: (payload: string) => void
  maxRetries?: number
  retryDelayMs?: number
}

interface ManagedStream {
  start: () => Promise<void>
  stop: () => void
  restart: () => Promise<void>
}

/** 带断线重连的 WebSocket 数据流；有消息到达即重置重试额度，stop 后不再重连。 */
function createManagedStream({
  resolvePath,
  onMessage,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS
}: ManagedStreamOptions): ManagedStream {
  let socket: WebSocket | null = null
  let retriesLeft = maxRetries
  let reconnectTimer: NodeJS.Timeout | null = null

  const clearReconnectTimer = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const connect = async (): Promise<void> => {
    const ws = await openControllerSocket(await resolvePath())
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
      if (socket !== null || !retriesLeft || reconnectTimer) return

      retriesLeft--
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect().catch(() => {})
      }, retryDelayMs)
    }

    ws.onerror = (): void => {
      ws.close()
    }
  }

  const start = async (): Promise<void> => {
    if (isWebSocketActive(socket)) return
    clearReconnectTimer()
    await connect()
  }

  const stop = (): void => {
    retriesLeft = maxRetries
    clearReconnectTimer()
    if (socket) {
      closeWebSocket(socket)
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

function broadcastLog(listeners: ReadonlySet<MihomoLogListener>, log: ControllerLog): void {
  for (const listener of listeners) {
    try {
      listener(log)
    } catch {
      // 单个订阅者异常不影响日志广播
    }
  }
}

const trafficStream = createManagedStream({
  resolvePath: async () => '/traffic',
  onMessage: (payload) => {
    const traffic = JSON.parse(payload) as ControllerTraffic
    mainWindow?.webContents.send('mihomoTraffic', traffic)
    if (process.platform !== 'linux') {
      tray?.setToolTip(
        '↑' +
          `${calcTraffic(traffic.up)}/s`.padStart(9) +
          '\n↓' +
          `${calcTraffic(traffic.down)}/s`.padStart(9)
      )
    }
    floatingWindow?.webContents.send('mihomoTraffic', traffic)
  }
})

const memoryStream = createManagedStream({
  resolvePath: async () => '/memory',
  onMessage: (payload) => {
    mainWindow?.webContents.send('mihomoMemory', JSON.parse(payload) as ControllerMemory)
  }
})

const logListeners = new Set<MihomoLogListener>()

const logsStream = createManagedStream({
  resolvePath: async () => {
    const { realtimeLogLevel } = await getAppConfig()
    const { 'log-level': logLevel = 'info' } = await getControledMihomoConfig()
    return `/logs?level=${realtimeLogLevel ?? logLevel}`
  },
  onMessage: (payload) => {
    const log = JSON.parse(payload) as ControllerLog
    publishMihomoLog(log)
    broadcastLog(logListeners, log)
  }
})

const connectionsStream = createManagedStream({
  resolvePath: async () => {
    const { connectionInterval = 500 } = await getAppConfig()
    return `/connections?interval=${connectionInterval}`
  },
  onMessage: (payload) => {
    mainWindow?.webContents.send('mihomoConnections', JSON.parse(payload) as ControllerConnections)
  }
})

const alertListeners = new Set<MihomoLogListener>()

const alertsStream = createManagedStream({
  resolvePath: async () => '/logs?level=warning',
  onMessage: (payload) => broadcastLog(alertListeners, JSON.parse(payload) as ControllerLog),
  maxRetries: Number.POSITIVE_INFINITY,
  retryDelayMs: ALERTS_RETRY_DELAY_MS
})

export const startMihomoTraffic = trafficStream.start
export const stopMihomoTraffic = trafficStream.stop
export const startMihomoMemory = memoryStream.start
export const stopMihomoMemory = memoryStream.stop
export const startMihomoLogs = logsStream.start
export const stopMihomoLogs = logsStream.stop
export const restartMihomoLogs = logsStream.restart
export const startMihomoConnections = connectionsStream.start
export const stopMihomoConnections = connectionsStream.stop
export const restartMihomoConnections = connectionsStream.restart

/** 订阅内核日志流（供按需探测等活动判定使用）；返回取消订阅函数。 */
export function subscribeMihomoLogs(listener: MihomoLogListener): () => void {
  logListeners.add(listener)
  return () => {
    logListeners.delete(listener)
  }
}

/** 订阅内核 warning 及以上级别日志；首个订阅者建立数据流，最后一个取消后关闭。 */
export function subscribeMihomoAlerts(listener: MihomoLogListener): () => void {
  alertListeners.add(listener)
  if (alertListeners.size === 1) {
    void alertsStream.start().catch(() => {})
  }
  return () => {
    alertListeners.delete(listener)
    if (alertListeners.size === 0) {
      alertsStream.stop()
    }
  }
}
