import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { setImmediate as settle } from 'node:timers/promises'

type CorePermissionMode = 'elevated' | 'service' | undefined

interface Notification {
  title: string
  body?: string
  variant?: string
}

const RECOVERY_DEBOUNCE_MS = 3_000
const TUN_PERMISSION_TIMEOUT_MS = 60_000
const PERMISSION_ERROR_LINE =
  'Start TUN listening error: configure tun interface: operation not permitted'

const world: {
  tunEnabled: boolean
  mode: CorePermissionMode
  core: string
  hasSetuid: boolean
  setuidChecks: number
  grantImpl: (cores: string[]) => Promise<void>
  grants: string[][]
  restartImpl: () => Promise<void>
  restarts: number
  logs: string[]
  notifications: Notification[]
  sysProxyEnabled: boolean
  patches: unknown[]
  sysProxyCalls: unknown[][]
} = {
  tunEnabled: true,
  mode: 'elevated',
  core: 'mihomo',
  hasSetuid: false,
  setuidChecks: 0,
  grantImpl: async () => undefined,
  grants: [],
  restartImpl: async () => undefined,
  restarts: 0,
  logs: [],
  notifications: [],
  sysProxyEnabled: false,
  patches: [],
  sysProxyCalls: []
}

let moduleMocked = false

function loadModule(): typeof import('./tunStartupGuard') {
  if (!moduleMocked) {
    mock.module('../config', {
      exports: {
        getControledMihomoConfig: async () => ({ tun: { enable: world.tunEnabled } }),
        getAppConfig: async () => ({
          core: world.core,
          corePermissionMode: world.mode,
          sysProxy: { enable: world.sysProxyEnabled },
          onlyActiveDevice: false
        }),
        patchAppConfig: async (patch: unknown) => {
          world.patches.push(patch)
        }
      }
    })
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (message: string) => {
          world.logs.push(message)
        }
      }
    })
    mock.module('../utils/notification', {
      exports: {
        showNotification: async (notification: Notification) => {
          world.notifications.push(notification)
        }
      }
    })
    mock.module('./permission', {
      exports: {
        checkCorePermissionSync: () => {
          world.setuidChecks += 1
          return world.hasSetuid
        },
        manualGrantCorePermition: async (cores: string[]) => {
          world.grants.push(cores)
          await world.grantImpl(cores)
        }
      }
    })
    mock.module('../sys/sysproxy', {
      exports: {
        triggerSysProxy: async (...args: unknown[]) => {
          world.sysProxyCalls.push(args)
        }
      }
    })
    mock.module('electron', {
      exports: { BrowserWindow: { getAllWindows: () => [] } }
    })
    mock.module('./manager', {
      exports: {
        restartCore: async () => {
          world.restarts += 1
          await world.restartImpl()
        }
      }
    })
    moduleMocked = true
  }
  delete require.cache[require.resolve('./tunStartupGuard')]
  return require('./tunStartupGuard')
}

/** 推进假时钟，再让回调里的 await 链跑完（timers/promises 的 setImmediate 不受假时钟影响）。 */
async function advance(ms: number): Promise<void> {
  mock.timers.tick(ms)
  await settle()
  await settle()
}

describe('tunStartupGuard', () => {
  beforeEach(() => {
    world.tunEnabled = true
    world.mode = 'elevated'
    world.core = 'mihomo'
    world.hasSetuid = false
    world.setuidChecks = 0
    world.grantImpl = async () => undefined
    world.grants = []
    world.restartImpl = async () => undefined
    world.restarts = 0
    world.logs = []
    world.notifications = []
    world.sysProxyEnabled = false
    world.patches = []
    world.sysProxyCalls = []
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  })

  afterEach(() => {
    mock.timers.reset()
  })

  describe('ensureTunCorePermissionBeforeStart', () => {
    it('never asks for a password in service mode, even when the core has no setuid', async () => {
      world.mode = 'service'
      world.hasSetuid = false

      await loadModule().ensureTunCorePermissionBeforeStart()

      assert.deepEqual(world.grants, [])
      assert.deepEqual(world.notifications, [])
      assert.deepEqual(world.logs, [])
      assert.equal(world.setuidChecks, 0, 'service mode must not even probe the setuid bit')
    })

    it('requests the grant for the enabled core when running elevated without setuid', async () => {
      world.core = 'mihomo-alpha'

      await loadModule().ensureTunCorePermissionBeforeStart()

      assert.deepEqual(world.grants, [['mihomo-alpha']])
      assert.ok(world.logs.some((line) => line.includes('requesting permission before start')))
      assert.ok(world.logs.some((line) => line.includes('core permission granted before start')))
      assert.deepEqual(world.patches, [])
    })

    it('treats an unset mode like the app default (elevated)', async () => {
      world.mode = undefined

      await loadModule().ensureTunCorePermissionBeforeStart()

      assert.deepEqual(world.grants, [['mihomo']])
    })

    it('does nothing when the core already carries setuid', async () => {
      world.hasSetuid = true

      await loadModule().ensureTunCorePermissionBeforeStart()

      assert.deepEqual(world.grants, [])
      assert.deepEqual(world.notifications, [])
    })

    it('does nothing when tun is disabled', async () => {
      world.tunEnabled = false

      await loadModule().ensureTunCorePermissionBeforeStart()

      assert.deepEqual(world.grants, [])
      assert.equal(world.setuidChecks, 0)
    })

    it('falls back to the system proxy when the grant fails', async () => {
      world.grantImpl = async () => {
        throw new Error('user declined')
      }

      await loadModule().ensureTunCorePermissionBeforeStart()

      assert.ok(world.logs.some((line) => line.includes('pre-start permission grant skipped')))
      assert.deepEqual(world.patches, [{ sysProxy: { enable: true } }])
      assert.deepEqual(world.sysProxyCalls, [[true, false]])
    })

    it('gives up after the permission timeout and tells the user', async () => {
      world.grantImpl = () =>
        new Promise<void>(() => {
          // 永不结算：模拟用户一直没响应授权框。
        })
      const pending = loadModule().ensureTunCorePermissionBeforeStart()
      await settle()

      await advance(TUN_PERMISSION_TIMEOUT_MS)
      await pending

      assert.ok(world.notifications.some((item) => item.title === 'TUN 授权超时'))
      assert.deepEqual(world.sysProxyCalls, [[true, false]])
    })

    it('leaves no timer behind once the grant finishes first', async () => {
      await loadModule().ensureTunCorePermissionBeforeStart()

      mock.timers.tick(TUN_PERMISSION_TIMEOUT_MS * 2)
      await settle()

      assert.equal(
        world.notifications.some((item) => item.title === 'TUN 授权超时'),
        false
      )
      assert.deepEqual(world.sysProxyCalls, [])
    })
  })

  describe('verifyTunAfterCoreReady', () => {
    it('does not recover or restart anything in service mode', async () => {
      world.mode = 'service'

      await loadModule().verifyTunAfterCoreReady()

      assert.deepEqual(world.grants, [])
      assert.equal(world.restarts, 0)
    })

    it('grants and restarts the core when running elevated without setuid', async () => {
      await loadModule().verifyTunAfterCoreReady()

      assert.deepEqual(world.grants, [['mihomo']])
      assert.equal(world.restarts, 1)
      assert.ok(world.logs.some((line) => line.includes('recovering TUN permission')))
    })

    it('is a no-op once the tun adapter is listening', async () => {
      const guard = loadModule()
      guard.watchTunStartupLogLine('[TUN] Tun adapter listening at: utun4([198.18.0.1/30],[])')

      await guard.verifyTunAfterCoreReady()

      assert.deepEqual(world.grants, [])
      assert.equal(world.restarts, 0)
    })

    it('is a no-op when tun is disabled', async () => {
      world.tunEnabled = false

      await loadModule().verifyTunAfterCoreReady()

      assert.deepEqual(world.grants, [])
      assert.equal(world.restarts, 0)
    })
  })

  describe('permission errors in the core log', () => {
    it('restarts the core without asking for a password in service mode', async () => {
      world.mode = 'service'
      const guard = loadModule()

      guard.watchTunStartupLogLine(PERMISSION_ERROR_LINE)
      await advance(RECOVERY_DEBOUNCE_MS)

      assert.deepEqual(world.grants, [])
      assert.equal(world.restarts, 1)
      assert.ok(world.logs.some((line) => line.includes('requirement satisfied but TUN failed')))
    })

    it('grants permission and restarts the core when elevated without setuid', async () => {
      const guard = loadModule()

      guard.watchTunStartupLogLine(PERMISSION_ERROR_LINE)
      await advance(RECOVERY_DEBOUNCE_MS)

      assert.deepEqual(world.grants, [['mihomo']])
      assert.equal(world.restarts, 1)
    })

    it('points service-mode users at the service, not at a settings page that is hidden', async () => {
      world.mode = 'service'
      world.restartImpl = async () => {
        throw new Error('core refused to start')
      }
      const guard = loadModule()

      guard.watchTunStartupLogLine(PERMISSION_ERROR_LINE)
      await advance(RECOVERY_DEBOUNCE_MS)

      const failure = world.notifications.find((item) => item.title.includes('TUN 启动失败'))
      assert.ok(failure, 'a failure notification must be shown')
      assert.match(failure.body ?? '', /Sparkle 服务/)
      assert.doesNotMatch(failure.body ?? '', /手动授予内核权限/)
      assert.deepEqual(world.sysProxyCalls, [[true, false]])
    })

    it('tells elevated users how to grant the permission by hand', async () => {
      world.restartImpl = async () => {
        throw new Error('core refused to start')
      }
      const guard = loadModule()

      guard.watchTunStartupLogLine(PERMISSION_ERROR_LINE)
      await advance(RECOVERY_DEBOUNCE_MS)

      const failure = world.notifications.find((item) => item.title.includes('TUN 启动失败'))
      assert.ok(failure)
      assert.match(failure.body ?? '', /手动授予内核权限/)
    })

    it('stops retrying after two failed attempts', async () => {
      world.mode = 'service'
      world.restartImpl = async () => {
        throw new Error('core refused to start')
      }
      const guard = loadModule()

      for (let round = 0; round < 3; round += 1) {
        guard.watchTunStartupLogLine(PERMISSION_ERROR_LINE)
        await advance(RECOVERY_DEBOUNCE_MS)
      }

      assert.equal(world.restarts, 2)
    })

    it('keeps the attempt budget across the guard reset every core start performs', async () => {
      world.mode = 'service'
      const guard = loadModule()

      for (let round = 0; round < 4; round += 1) {
        guard.watchTunStartupLogLine(PERMISSION_ERROR_LINE)
        await advance(RECOVERY_DEBOUNCE_MS)
        guard.resetTunStartupGuardState()
      }

      assert.equal(world.restarts, 2, 'a persistent error must not restart the core forever')
    })

    it('forgives earlier failures once the tun adapter listens', async () => {
      world.mode = 'service'
      const guard = loadModule()

      for (let round = 0; round < 2; round += 1) {
        guard.watchTunStartupLogLine(PERMISSION_ERROR_LINE)
        await advance(RECOVERY_DEBOUNCE_MS)
        guard.resetTunStartupGuardState()
      }
      guard.watchTunStartupLogLine('[TUN] Tun adapter listening at: utun4([198.18.0.1/30],[])')
      guard.watchTunStartupLogLine(PERMISSION_ERROR_LINE)
      await advance(RECOVERY_DEBOUNCE_MS)

      assert.equal(world.restarts, 3)
    })
  })
})
