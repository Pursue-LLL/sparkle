import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcMainHandlers } from './utils/ipc'
import { app, shell, BrowserWindow, Menu } from 'electron'
import { getAppConfig } from './config'
import { quitWithoutCore, stopCore } from './core/manager'
import { disableSysProxySync, triggerSysProxy } from './sys/sysproxy'
import icon from '../../resources/icon.png?asset'
import { createTray } from './resolve/tray'
import { createApplicationMenu } from './resolve/menu'
import { init } from './utils/init'
import { join } from 'path'
import { initShortcut } from './resolve/shortcut'
import { runPostCoreBootstrap } from './core/postCoreBootstrap'
import { startMonitor } from './resolve/trafficMonitor'
import { showFloatingWindow } from './resolve/floatingWindow'
import { getAppConfigSync } from './config/app'
import { createMainWindowStateManager } from './resolve/mainWindowState'
import {
  applyWindowsGpuWorkaround,
  ensureWindowsElevatedStartup,
  useLinuxCustomRelaunch
} from './sys/startup'
import { shouldForceDisableGpu, shouldUseMacOs26HeadlessBootstrap, wantsMacOs26ForceGui } from './sys/macos26ElectronMitigationCore'
import { persistMacOs26ForceGuiIfRequested } from './sys/macos26ForceGuiPreferenceCore'
import { runMacOs26HeadlessBootstrap } from './sys/macos26HeadlessBootstrap'
import { PROFILE_UPDATE_DUE_ARG } from './core/profileUpdaterCore'
import { runProfileUpdateDueCli } from './core/profileUpdateDueCli'
import os from 'os'
import { handleDeepLink } from './resolve/deepLink'
import { initAppQuitLifecycle } from './resolve/appLifecycle'
import { showNotification } from './utils/notification'
import { appendAppLog } from './utils/log'

export { setNotQuitDialog } from './resolve/appLifecycle'

let quitTimeout: NodeJS.Timeout | null = null
export let mainWindow: BrowserWindow | null = null
let isCreatingWindow = false
let windowShown = false
let createWindowPromiseResolve: (() => void) | null = null
let createWindowPromise: Promise<void> | null = null
let initialWindowDisplayPromiseResolve: (() => void) | null = null
const initialWindowDisplayPromise = new Promise<void>((resolve) => {
  initialWindowDisplayPromiseResolve = resolve
})

async function scheduleLightweightMode(): Promise<void> {
  const {
    autoLightweight = false,
    autoLightweightDelay = 60,
    autoLightweightMode = 'core'
  } = await getAppConfig()

  if (!autoLightweight) return

  if (quitTimeout) {
    clearTimeout(quitTimeout)
  }

  const enterLightweightMode = async (): Promise<void> => {
    if (autoLightweightMode === 'core') {
      await quitWithoutCore()
    } else if (autoLightweightMode === 'tray') {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.destroy()
        if (process.platform === 'darwin' && app.dock) {
          app.dock.hide()
        }
      }
    }
  }

  quitTimeout = setTimeout(enterLightweightMode, autoLightweightDelay * 1000)
}

const syncConfig = getAppConfigSync()

function exitApp(): void {
  disableSysProxySync()
  app.exit()
}

function clearLightweightTimeout(): void {
  if (quitTimeout) {
    clearTimeout(quitTimeout)
    quitTimeout = null
  }
}

function runStartupTask(name: string, task: Promise<unknown>): void {
  task.catch((error) => {
    appendAppLog(`[App]: startup task ${name} failed, ${error}\n`).catch(() => {})
  })
}

ensureWindowsElevatedStartup(syncConfig.corePermissionMode, exitApp)

const gotTheLock = app.requestSingleInstanceLock()
const instanceAudit =
  `[AppLifecycle]: instance_lock acquired=${gotTheLock ? 1 : 0}` +
  ` pid=${process.pid} ppid=${process.ppid} version=${app.getVersion()}\n`

if (!gotTheLock) {
  void appendAppLog(instanceAudit)
    .catch(() => {})
    .finally(() => app.exit(0))
} else {
  void appendAppLog(instanceAudit).catch(() => {})
  useLinuxCustomRelaunch()
  applyWindowsGpuWorkaround()

  const syncConfigForHeadless = getAppConfigSync()
  const macOs26HeadlessLaunch =
    shouldUseMacOs26HeadlessBootstrap(
      process.platform,
      os.release(),
      wantsMacOs26ForceGui(process.argv, process.env, syncConfigForHeadless.macos26ForceGui),
    )

  const initPromise = init({ skipBackgroundInit: macOs26HeadlessLaunch })

  if (shouldForceDisableGpu(process.platform, os.release(), syncConfig.disableGPU ?? false)) {
    app.disableHardwareAcceleration()
  }

  app.on('second-instance', async (_event, commandline) => {
    await appendAppLog(
      `[AppLifecycle]: second_instance_event primary_pid=${process.pid} argv_count=${commandline.length}\n`
    )
    if (commandline.includes(PROFILE_UPDATE_DUE_ARG)) {
      try {
        const { runDueProfileUpdates } = await import('./core/profileUpdater')
        const updatedCount = await runDueProfileUpdates('cli')
        await appendAppLog(`[ProfileUpdaterCli]: second-instance updated_count=${updatedCount}\n`)
      } catch (error) {
        await appendAppLog(
          `[ProfileUpdaterCli]: second-instance failed: ${error instanceof Error ? error.message : String(error)}\n`
        )
      }
      return
    }
    showMainWindow()
    const url = commandline.pop()
    if (url) {
      await handleDeepLink(url, { getMainWindow: () => mainWindow, createWindow, showWindow })
    }
  })

  app.on('open-url', async (_event, url) => {
    showMainWindow()
    await handleDeepLink(url, { getMainWindow: () => mainWindow, createWindow, showWindow })
  })

  function showWindow(): number {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      } else if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focusOnWebView()
      mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(false)

      if (!mainWindow.isMinimized()) {
        return 100
      }
    }
    return 500
  }

  initAppQuitLifecycle({
    getMainWindow: () => mainWindow,
    showWindow,
    clearLightweightTimeout,
    exitApp
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('sparkle.app')
    let appConfig: AppConfig
    try {
      appConfig = await initPromise
    } catch (e) {
      void showNotification({ title: '应用初始化失败', body: `${e}`, variant: 'danger' })
      app.quit()
      return
    }

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })
    const { showFloatingWindow: showFloating = false, disableTray = false } = appConfig

    const forceGui = wantsMacOs26ForceGui(
      process.argv,
      process.env,
      appConfig.macos26ForceGui,
    )

    void persistMacOs26ForceGuiIfRequested(
      process.argv,
      process.env,
      appConfig.macos26ForceGui,
    ).catch(() => {})

    if (process.argv.includes(PROFILE_UPDATE_DUE_ARG)) {
      try {
        await runProfileUpdateDueCli()
      } catch (error) {
        await appendAppLog(
          `[ProfileUpdaterCli]: exit error: ${error instanceof Error ? error.message : String(error)}\n`
        )
        app.exit(1)
        return
      }
      app.exit(0)
      return
    }

    if (shouldUseMacOs26HeadlessBootstrap(process.platform, os.release(), forceGui)) {
      await runMacOs26HeadlessBootstrap()
      return
    }

    registerIpcMainHandlers()

    const createWindowPromise = createWindow(appConfig)

    let coreStarted = false

    const coreStartPromise = (async (): Promise<void> => {
      try {
        if (is.dev) {
          await initialWindowDisplayPromise
        }
        const { runCoreReadinessPipeline } = await import('./core/coreReadinessGate')
        const { startPromise } = await runCoreReadinessPipeline('gui')
        void runPostCoreBootstrap(startPromise).catch(async (error) => {
          await appendAppLog(
            `[PostCoreBootstrap]: failed: ${error instanceof Error ? error.message : String(error)}\n`
          )
        })
        coreStarted = true
      } catch (e) {
        void showNotification({ title: '内核启动出错', body: `${e}`, variant: 'danger' })
      }
    })()

    runStartupTask('traffic monitor', startMonitor())

    await createWindowPromise

    const uiTasks: Promise<void>[] = [initShortcut()]

    if (showFloating) {
      uiTasks.push(Promise.resolve(showFloatingWindow()))
    }
    if (!disableTray) {
      uiTasks.push(createTray())
    }

    runStartupTask('ui extras', Promise.all(uiTasks))
    coreStartPromise.then(() => {
      if (coreStarted) {
        mainWindow?.webContents.send('core-started')
      }
    })

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      showMainWindow()
    })
  })
}

export async function createWindow(appConfig?: AppConfig): Promise<void> {
  if (isCreatingWindow) {
    if (createWindowPromise) {
      await createWindowPromise
    }
    return
  }
  isCreatingWindow = true
  createWindowPromise = new Promise<void>((resolve) => {
    createWindowPromiseResolve = resolve
  })
  try {
    const config = appConfig ?? (await getAppConfig())
    const { useWindowFrame = false } = config
    const [windowStateManager] = await Promise.all([
      Promise.resolve(createMainWindowStateManager()),
      process.platform === 'darwin'
        ? createApplicationMenu()
        : Promise.resolve(Menu.setApplicationMenu(null))
    ])
    const windowState = windowStateManager.state
    mainWindow = new BrowserWindow({
      minWidth: 800,
      minHeight: 600,
      width: windowState.width,
      height: windowState.height,
      x: windowState.x,
      y: windowState.y,
      show: false,
      frame: useWindowFrame,
      fullscreenable: false,
      titleBarStyle: useWindowFrame ? 'default' : 'hidden',
      titleBarOverlay: useWindowFrame
        ? false
        : {
            height: 49
          },
      autoHideMenuBar: true,
      ...(process.platform === 'linux' ? { icon: icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        spellcheck: false,
        sandbox: false,
        ...(is.dev ? { webSecurity: false } : {})
      }
    })
    windowStateManager.attach(mainWindow)
    mainWindow.on('ready-to-show', async () => {
      const { silentStart = false } = await getAppConfig()
      if (!silentStart) {
        if (quitTimeout) {
          clearTimeout(quitTimeout)
        }
        windowShown = true
        mainWindow?.show()
        mainWindow?.focusOnWebView()
        initialWindowDisplayPromiseResolve?.()
        initialWindowDisplayPromiseResolve = null
      } else {
        await scheduleLightweightMode()
        initialWindowDisplayPromiseResolve?.()
        initialWindowDisplayPromiseResolve = null
      }
    })
    mainWindow.webContents.on('did-fail-load', () => {
      mainWindow?.webContents.reload()
    })

    mainWindow.on('close', async (event) => {
      event.preventDefault()
      mainWindow?.hide()
      if (windowShown) {
        await scheduleLightweightMode()
      }
    })

    mainWindow.on('closed', () => {
      windowStateManager.cleanup()
      mainWindow = null
    })

    mainWindow.on('resized', windowStateManager.save)
    mainWindow.on('unmaximize', windowStateManager.save)
    mainWindow.on('move', windowStateManager.save)

    mainWindow.on('session-end', async () => {
      await triggerSysProxy(false, false, true)
      await stopCore()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  } finally {
    isCreatingWindow = false
    if (createWindowPromiseResolve) {
      createWindowPromiseResolve()
      createWindowPromiseResolve = null
    }
    createWindowPromise = null
  }
}

export async function triggerMainWindow(): Promise<void> {
  if (mainWindow && mainWindow.isVisible()) {
    closeMainWindow()
  } else {
    await showMainWindow()
  }
}

export async function showMainWindow(): Promise<void> {
  if (quitTimeout) {
    clearTimeout(quitTimeout)
  }
  if (process.platform === 'darwin' && app.dock) {
    const { useDockIcon = true } = await getAppConfig()
    if (!useDockIcon) {
      app.dock.hide()
    }
  }
  if (mainWindow) {
    windowShown = true
    mainWindow.show()
    mainWindow.focusOnWebView()
  } else {
    await createWindow()
    if (mainWindow !== null) {
      windowShown = true
      ;(mainWindow as BrowserWindow).show()
      ;(mainWindow as BrowserWindow).focusOnWebView()
    }
  }
}

export function closeMainWindow(): void {
  if (mainWindow) {
    mainWindow.close()
  }
}
