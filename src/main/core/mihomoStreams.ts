// [INPUT] config::getAppConfig/getControledMihomoConfig · utils/dirs::mihomoIpcPath/serviceIpcPath ·
//         service/api::getServiceAuthHeaders · index::mainWindow · resolve/tray · resolve/floatingWindow · utils/log::publishMihomoLog ·
//         managedStream::createManagedStream (POS: 数据流连接生命周期) · listenerHub::createListenerHub (POS: 订阅者广播)
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
import { createListenerHub } from './listenerHub'
import { createManagedStream, type ManagedStream, type ManagedStreamOptions } from './managedStream'

const ALERTS_RETRY_DELAY_MS = 3000

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

function createControllerStream(options: Omit<ManagedStreamOptions, 'openSocket'>): ManagedStream {
  return createManagedStream({ ...options, openSocket: openControllerSocket })
}

const trafficStream = createControllerStream({
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

const memoryStream = createControllerStream({
  resolvePath: async () => '/memory',
  onMessage: (payload) => {
    mainWindow?.webContents.send('mihomoMemory', JSON.parse(payload) as ControllerMemory)
  }
})

const logHub = createListenerHub<ControllerLog>()

const logsStream = createControllerStream({
  resolvePath: async () => {
    const { realtimeLogLevel } = await getAppConfig()
    const { 'log-level': logLevel = 'info' } = await getControledMihomoConfig()
    return `/logs?level=${realtimeLogLevel ?? logLevel}`
  },
  onMessage: (payload) => {
    const log = JSON.parse(payload) as ControllerLog
    publishMihomoLog(log)
    logHub.publish(log)
  }
})

const connectionsStream = createControllerStream({
  resolvePath: async () => {
    const { connectionInterval = 500 } = await getAppConfig()
    return `/connections?interval=${connectionInterval}`
  },
  onMessage: (payload) => {
    mainWindow?.webContents.send('mihomoConnections', JSON.parse(payload) as ControllerConnections)
  }
})

const alertsStream = createControllerStream({
  resolvePath: async () => '/logs?level=warning',
  onMessage: (payload) => alertHub.publish(JSON.parse(payload) as ControllerLog),
  maxRetries: Number.POSITIVE_INFINITY,
  retryDelayMs: ALERTS_RETRY_DELAY_MS
})

const alertHub = createListenerHub<ControllerLog>({
  onFirstSubscribed: () => {
    void alertsStream.start().catch(() => {})
  },
  onLastUnsubscribed: alertsStream.stop
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
export const subscribeMihomoLogs = logHub.subscribe

/** 订阅内核 warning 及以上级别日志；首个订阅者建立数据流，最后一个取消后关闭。 */
export const subscribeMihomoAlerts = alertHub.subscribe
