import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { setImmediate as settle } from 'node:timers/promises'
import type { BrowserWindow } from 'electron'

interface QuitEvent {
  prevented: boolean
  preventDefault: () => void
}
type QuitHandler = (event: QuitEvent) => Promise<void>
type ConfirmListener = (event: unknown, confirmed: boolean) => void

const DIALOG_DELAY_MS = 100
const NOW_MS = Date.UTC(2026, 10, 15, 12, 0, 0)
/** 干净退出的完整副作用顺序：清定时器 → 写正常退出戳 → 关系统代理与停内核 → 真正退出。 */
const FULL_QUIT = ['clearTimeout', 'markGraceful', 'sysproxy:false', 'stopCore', 'exitApp']

const world: {
  upgradeActive: boolean
  hasWindow: boolean
  calls: string[]
  sent: string[]
  quitHandler: QuitHandler | null
  confirm: ConfirmListener | null
} = {
  upgradeActive: false,
  hasWindow: true,
  calls: [],
  sent: [],
  quitHandler: null,
  confirm: null
}

const fakeWindow = {
  webContents: { send: (channel: string): number => world.sent.push(channel) }
} as unknown as BrowserWindow

const context = {
  getMainWindow: (): BrowserWindow | null => (world.hasWindow ? fakeWindow : null),
  showWindow: (): number => DIALOG_DELAY_MS,
  clearLightweightTimeout: (): void => {
    world.calls.push('clearTimeout')
  },
  exitApp: (): void => {
    world.calls.push('exitApp')
  }
}

let moduleMocked = false

function loadLifecycle(): typeof import('./appLifecycle') {
  if (!moduleMocked) {
    mock.module('electron', {
      exports: {
        app: {
          on: (name: string, handler: QuitHandler): void => {
            if (name === 'before-quit') world.quitHandler = handler
          }
        },
        ipcMain: {
          once: (_channel: string, listener: ConfirmListener): void => {
            world.confirm = listener
          },
          off: (): void => undefined
        },
        powerMonitor: { on: (): void => undefined }
      }
    })
    mock.module('../core/manager', {
      exports: {
        stopCore: async (): Promise<void> => {
          world.calls.push('stopCore')
        }
      }
    })
    mock.module('../sys/sysproxy', {
      exports: {
        disableSysProxySync: (): void => undefined,
        triggerSysProxy: async (enable: boolean): Promise<void> => {
          world.calls.push(`sysproxy:${enable}`)
        }
      }
    })
    mock.module('../sys/guiGracefulQuitMarker', {
      exports: {
        markGracefulGuiQuit: (): void => {
          world.calls.push('markGraceful')
        }
      }
    })
    mock.module('../sys/upgradeQuiesce', {
      exports: { isUpgradeQuiesceActive: (): boolean => world.upgradeActive }
    })
    mock.module('../utils/log', {
      exports: { appendAppLog: async (): Promise<void> => undefined }
    })
    moduleMocked = true
  }
  // 退出状态（isQuitting / notQuitDialog / lastQuitAttempt）是模块级的，每个用例都要一份全新的。
  delete require.cache[require.resolve('./appLifecycle')]
  return require('./appLifecycle')
}

function emitBeforeQuit(): { event: QuitEvent; done: Promise<void> } {
  assert.ok(world.quitHandler, 'initAppQuitLifecycle must register a before-quit handler')
  const event: QuitEvent = {
    prevented: false,
    preventDefault: () => {
      event.prevented = true
    }
  }
  return { event, done: world.quitHandler(event) }
}

function startLifecycle(): typeof import('./appLifecycle') {
  const lifecycle = loadLifecycle()
  lifecycle.initAppQuitLifecycle(context)
  return lifecycle
}

/** 排空微任务后仍未结束，说明在等一个永远不会来的回答：用例应当失败，而不是挂住整个套件。 */
async function finished(done: Promise<void>): Promise<void> {
  const state = await Promise.race([done.then(() => 'done'), settle().then(() => 'pending')])
  assert.equal(state, 'done', 'the quit is still waiting for an answer')
}

function answerDialog(confirmed: boolean): void {
  assert.ok(world.confirm, 'the confirm dialog must be waiting for an answer')
  world.confirm(null, confirmed)
}

describe('appLifecycle before-quit', () => {
  beforeEach(() => {
    world.upgradeActive = false
    world.hasWindow = true
    world.calls = []
    world.sent = []
    world.quitHandler = null
    world.confirm = null
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW_MS })
  })

  afterEach(() => {
    mock.timers.reset()
  })

  describe('while an upgrade installer is replacing the app', () => {
    it('quits cleanly without showing the confirm dialog nobody would answer', async () => {
      world.upgradeActive = true
      startLifecycle()

      const { event, done } = emitBeforeQuit()
      await finished(done)

      assert.equal(event.prevented, false)
      assert.deepEqual(world.sent, [], 'no confirm dialog')
      assert.deepEqual(world.calls, FULL_QUIT)
    })

    it('checks the marker on every quit attempt, not once at startup', async () => {
      startLifecycle()
      const first = emitBeforeQuit()
      assert.equal(first.event.prevented, true, 'no upgrade yet: the dialog guards the quit')
      mock.timers.tick(DIALOG_DELAY_MS)
      assert.deepEqual(world.sent, ['show-quit-confirm'])

      world.upgradeActive = true
      mock.timers.tick(1_000)
      const second = emitBeforeQuit()
      await finished(second.done)

      assert.equal(second.event.prevented, false)
      assert.deepEqual(world.sent, ['show-quit-confirm'], 'the upgrade quit adds no second dialog')
      assert.deepEqual(world.calls, FULL_QUIT)
    })
  })

  describe('in normal use', () => {
    it('holds the quit and asks for confirmation, quitting only once it is confirmed', async () => {
      startLifecycle()

      const { event, done } = emitBeforeQuit()
      assert.equal(event.prevented, true)
      mock.timers.tick(DIALOG_DELAY_MS)
      assert.deepEqual(world.sent, ['show-quit-confirm'])
      assert.deepEqual(world.calls, [], 'nothing is torn down before the answer')

      answerDialog(true)
      await finished(done)

      assert.deepEqual(world.calls, FULL_QUIT)
    })

    it('keeps the app running when the confirmation is declined', async () => {
      startLifecycle()

      const { event, done } = emitBeforeQuit()
      mock.timers.tick(DIALOG_DELAY_MS)
      answerDialog(false)
      await finished(done)

      assert.equal(event.prevented, true)
      assert.deepEqual(world.calls, [])
    })

    it('quits at once when there is no window to show the dialog in', async () => {
      world.hasWindow = false
      startLifecycle()

      const { event, done } = emitBeforeQuit()
      await finished(done)

      assert.equal(event.prevented, true)
      assert.deepEqual(world.sent, [])
      assert.deepEqual(world.calls, FULL_QUIT)
    })

    it('treats a second quit within 500 ms as a deliberate force quit', async () => {
      startLifecycle()

      emitBeforeQuit()
      mock.timers.tick(499)
      const second = emitBeforeQuit()
      await finished(second.done)

      assert.deepEqual(world.calls, FULL_QUIT)
    })

    it('asks again when the second quit comes after the 500 ms window', async () => {
      startLifecycle()

      emitBeforeQuit()
      mock.timers.tick(500)
      const second = emitBeforeQuit()
      assert.equal(second.event.prevented, true)
      assert.deepEqual(world.calls, [], 'still waiting for an answer')
    })

    it('quits without a dialog once the tray, a shortcut or the updater asked for it', async () => {
      const lifecycle = startLifecycle()
      lifecycle.setNotQuitDialog()

      const { event, done } = emitBeforeQuit()
      await finished(done)

      assert.equal(event.prevented, false)
      assert.deepEqual(world.sent, [])
      assert.deepEqual(world.calls, FULL_QUIT)
    })

    it('lets a quit that is already underway proceed without a second teardown', async () => {
      startLifecycle()
      const first = emitBeforeQuit()
      mock.timers.tick(DIALOG_DELAY_MS)
      answerDialog(true)
      await finished(first.done)
      world.calls = []

      const again = emitBeforeQuit()
      await finished(again.done)

      assert.equal(again.event.prevented, false)
      assert.deepEqual(world.calls, [])
    })
  })
})
