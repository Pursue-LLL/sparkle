import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import { elapse, FakeSocket, flush } from './managedStreamRig'
import type * as MihomoStreams from './mihomoStreams'

type Sent = [target: 'main' | 'floating', channel: string, payload: unknown]

class FakeWebSocket extends FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readonly url: string
  readonly options: unknown

  constructor(url: string, options?: unknown) {
    super()
    this.url = url
    this.options = options
    sockets.push(this)
  }
}

const sockets: FakeWebSocket[] = []
const sent: Sent[] = []
const tooltips: string[] = []
const published: ControllerLog[] = []
const appConfig: Record<string, unknown> = {}
const coreConfig: Record<string, unknown> = {}

function windowStub(target: Sent[0]): {
  webContents: { send: (channel: string, payload: unknown) => void }
} {
  return {
    webContents: {
      send: (channel, payload) => {
        sent.push([target, channel, payload])
      }
    }
  }
}

function resetConfig(): void {
  for (const key of Object.keys(appConfig)) delete appConfig[key]
  for (const key of Object.keys(coreConfig)) delete coreConfig[key]
}

describe('mihomoStreams wiring', () => {
  let streams: typeof MihomoStreams

  before(async () => {
    // ws 同时发布 ESM / CJS 入口；被测代码经 CJS 加载，必须替换 CJS 入口。
    mock.module(require.resolve('ws'), { exports: { default: FakeWebSocket } })
    mock.module('..', { exports: { mainWindow: windowStub('main') } })
    mock.module('../config', {
      exports: {
        getAppConfig: async (): Promise<Record<string, unknown>> => appConfig,
        getControledMihomoConfig: async (): Promise<Record<string, unknown>> => coreConfig
      }
    })
    mock.module('../resolve/tray', {
      exports: {
        tray: {
          setToolTip: (text: string): void => {
            tooltips.push(text)
          }
        }
      }
    })
    mock.module('../resolve/floatingWindow', {
      exports: { floatingWindow: windowStub('floating') }
    })
    mock.module('../service/api', {
      exports: {
        getServiceAuthHeaders: (method: string, path: string): Record<string, string> => ({
          authorization: `${method} ${path}`
        })
      }
    })
    mock.module('../utils/dirs', {
      exports: {
        mihomoIpcPath: (): string => '/run/mihomo.sock',
        serviceIpcPath: (): string => '/run/service.sock'
      }
    })
    mock.module('../utils/log', {
      exports: {
        publishMihomoLog: (log: ControllerLog): void => {
          published.push(log)
        }
      }
    })
    streams = await import('./mihomoStreams')
  })

  beforeEach(() => {
    sockets.length = 0
    sent.length = 0
    tooltips.length = 0
    published.length = 0
    resetConfig()
    mock.timers.enable({ apis: ['setTimeout'] })
  })

  afterEach(() => {
    streams.stopMihomoTraffic()
    streams.stopMihomoMemory()
    streams.stopMihomoLogs()
    streams.stopMihomoConnections()
    mock.timers.reset()
  })

  after(() => {
    mock.restoreAll()
  })

  describe('traffic', () => {
    it('opens the controller socket directly when the core runs elevated', async () => {
      await streams.startMihomoTraffic()

      assert.equal(sockets.length, 1)
      assert.equal(sockets[0].url, 'ws+unix:/run/mihomo.sock:/traffic')
      assert.equal(sockets[0].options, undefined)
    })

    it('goes through the service with signed headers in service mode', async () => {
      appConfig.corePermissionMode = 'service'

      await streams.startMihomoTraffic()

      assert.equal(sockets[0].url, 'ws+unix:/run/service.sock:/core/controller/traffic')
      assert.deepEqual(sockets[0].options, {
        headers: { authorization: 'GET /core/controller/traffic' }
      })
    })

    it('forwards each sample to the windows and shows the speed in the tray', async () => {
      await streams.startMihomoTraffic()

      sockets[0].receive(JSON.stringify({ up: 512, down: 3 * 1024 * 1024 }))

      const traffic = { up: 512, down: 3 * 1024 * 1024 }
      assert.deepEqual(sent, [
        ['main', 'mihomoTraffic', traffic],
        ['floating', 'mihomoTraffic', traffic]
      ])
      assert.deepEqual(tooltips, ['↑  512 B/s\n↓3.00 MB/s'])
    })

    it('leaves the tray alone on linux', async () => {
      const original = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { value: 'linux' })
      try {
        await streams.startMihomoTraffic()

        sockets[0].receive(JSON.stringify({ up: 1, down: 2 }))

        assert.deepEqual(tooltips, [])
        assert.equal(sent.length, 2)
      } finally {
        Object.defineProperty(process, 'platform', original)
      }
    })

    it('stops by closing the socket and does not reconnect', async () => {
      await streams.startMihomoTraffic()

      streams.stopMihomoTraffic()
      await elapse(30_000)

      assert.equal(sockets.length, 1)
      assert.equal(sockets[0].closeCalls, 1)
    })
  })

  describe('memory', () => {
    it('forwards memory samples to the main window only', async () => {
      await streams.startMihomoMemory()

      sockets[0].receive(JSON.stringify({ inuse: 42, oslimit: 0 }))

      assert.equal(sockets[0].url, 'ws+unix:/run/mihomo.sock:/memory')
      assert.deepEqual(sent, [['main', 'mihomoMemory', { inuse: 42, oslimit: 0 }]])
    })
  })

  describe('logs', () => {
    it('streams at the core log level unless the UI picked its own', async () => {
      await streams.startMihomoLogs()
      assert.equal(sockets.at(-1)?.url, 'ws+unix:/run/mihomo.sock:/logs?level=info')

      streams.stopMihomoLogs()
      coreConfig['log-level'] = 'warning'
      await streams.startMihomoLogs()
      assert.equal(sockets.at(-1)?.url, 'ws+unix:/run/mihomo.sock:/logs?level=warning')

      streams.stopMihomoLogs()
      appConfig.realtimeLogLevel = 'debug'
      await streams.startMihomoLogs()
      assert.equal(sockets.at(-1)?.url, 'ws+unix:/run/mihomo.sock:/logs?level=debug')
    })

    it('publishes each log to the log view and to subscribers until they leave', async () => {
      const received: ControllerLog[] = []
      const unsubscribe = streams.subscribeMihomoLogs((log) => received.push(log))
      await streams.startMihomoLogs()

      sockets[0].receive(JSON.stringify({ type: 'info', payload: 'first' }))
      unsubscribe()
      sockets[0].receive(JSON.stringify({ type: 'info', payload: 'second' }))

      assert.deepEqual(
        published.map((log) => log.payload),
        ['first', 'second']
      )
      assert.deepEqual(
        received.map((log) => log.payload),
        ['first']
      )
    })

    it('reopens with the new level on restart', async () => {
      await streams.startMihomoLogs()
      appConfig.realtimeLogLevel = 'error'

      await streams.restartMihomoLogs()

      assert.equal(sockets[0].closeCalls, 1)
      assert.equal(sockets[1].url, 'ws+unix:/run/mihomo.sock:/logs?level=error')
    })
  })

  describe('connections', () => {
    it('polls at the configured interval and forwards snapshots to the main window', async () => {
      await streams.startMihomoConnections()
      assert.equal(sockets[0].url, 'ws+unix:/run/mihomo.sock:/connections?interval=500')

      streams.stopMihomoConnections()
      appConfig.connectionInterval = 1000
      await streams.restartMihomoConnections()
      assert.equal(sockets.at(-1)?.url, 'ws+unix:/run/mihomo.sock:/connections?interval=1000')

      sockets.at(-1)?.receive(JSON.stringify({ connections: [] }))
      assert.deepEqual(sent, [['main', 'mihomoConnections', { connections: [] }]])
    })
  })

  describe('alerts', () => {
    it('opens a warning-level stream for the first subscriber whatever level the UI uses', async () => {
      appConfig.realtimeLogLevel = 'debug'
      const received: ControllerLog[] = []

      const unsubscribe = streams.subscribeMihomoAlerts((log) => received.push(log))
      await flush()
      sockets[0].receive(JSON.stringify({ type: 'warning', payload: 'because X failed' }))
      unsubscribe()

      assert.equal(sockets.length, 1)
      assert.equal(sockets[0].url, 'ws+unix:/run/mihomo.sock:/logs?level=warning')
      assert.deepEqual(received, [{ type: 'warning', payload: 'because X failed' }])
      assert.deepEqual(published, [], 'alerts are not shown in the log view')
    })

    it('shares one stream between subscribers and closes it with the last one', async () => {
      const first = streams.subscribeMihomoAlerts(() => undefined)
      const second = streams.subscribeMihomoAlerts(() => undefined)
      await flush()

      first()
      assert.equal(sockets[0].closeCalls, 0)
      second()

      assert.equal(sockets.length, 1)
      assert.equal(sockets[0].closeCalls, 1)
    })

    it('keeps reconnecting every three seconds, however long the core is away', async () => {
      const unsubscribe = streams.subscribeMihomoAlerts(() => undefined)
      await flush()

      for (let attempt = 1; attempt <= 25; attempt++) {
        sockets.at(-1)?.drop()
        await elapse(3000)
        assert.equal(sockets.length, attempt + 1, `reconnect ${attempt}`)
      }
      unsubscribe()
    })
  })
})
