// [INPUT] config::getAppConfig/patchAppConfig/getControledMihomoConfig/patchControledMihomoConfig… (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         cursorPathPrefixProfileReloadCore::shouldReloadProfileForAppConfigPatch (POS: Cursor 路径前缀变更的重载判定) ·
//         factory::getRuntimeConfig/getRuntimeConfigStr/getRawProfileStr/getCurrentProfileStr… (POS: runtime 配置生成) ·
//         manager::quitWithoutCore/restartCore/startNetworkDetection/stopCore… (POS: 内核进程生命周期) ·
//         mihomoApi::mihomoChangeProxy/mihomoCloseConnections/mihomoCloseConnection/mihomoGroupDelay… (POS: mihomo 控制器访问层) ·
//         permission::checkCorePermission/manualGrantCorePermition/revokeCorePermission (POS: 内核授权（setuid）的检查、授予与撤销) ·
//         probeWarmupState::isProbeWarmupActive (POS: 测速预热窗口状态) ·
//         resolve/autoUpdater::checkUpdate/downloadAndInstallUpdate/cancelUpdate (POS: 应用更新检查与安装) ·
//         resolve/backup::listWebdavBackups/webdavBackup/webdavDelete/webdavRestore (POS: WebDAV 备份) ·
//         resolve/floatingWindow::closeFloatingWindow/showContextMenu/showFloatingWindow (POS: 悬浮窗) ·
//         resolve/gistApi::getGistUrl (POS: Gist 运行时配置上传) ·
//         resolve/server::startSubStoreFrontendServer/startSubStoreBackendServer/stopSubStoreFrontendServer/stopSubStoreBackendServer… (POS: 本地服务端口) ·
//         resolve/shortcut::registerShortcut (POS: 全局快捷键) ·
//         resolve/theme::applyTheme/fetchThemes/importThemes/readTheme… (POS: 主题管理) ·
//         resolve/trafficMonitor::startMonitor (POS: 流量监视子进程) ·
//         resolve/tray::closeTrayIcon/copyEnv/setDockVisible/showTrayIcon… (POS: 托盘) ·
//         runtimeConfigSync::syncRuntimeConfigToCore (POS: 运行时配置对齐接线) ·
//         service/api::patchCoreProfile (POS: service 模式签名 API) ·
//         service/manager::serviceStatus/installService/uninstallService/startService… (POS: service 密钥管理与初始化) ·
//         sparkleAgyProbeSnapshot::getSparkleAgyProbeSnapshot (POS: agy 展示快照) ·
//         sparkleGrokProbeSnapshot::getSparkleGrokProbeSnapshot (POS: grok 展示快照) ·
//         src/shared/buildStamp::SPARKLE_BUILD_STAMP/SPARKLE_SEMVER (POS: 构建标识) ·
//         subStoreApi::subStoreCollections/subStoreSubs (POS: Sub-Store 订阅接口) ·
//         sys/autoRun::checkAutoRun/disableAutoRun/enableAutoRun (POS: 开机自启) ·
//         sys/interface::getInterfaces (POS: 网卡信息) ·
//         sys/misc::checkElevateTask/deleteElevateTask/getFilePath/openFile… (POS: 系统杂项（文件读取、防火墙、提权任务）) ·
//         sys/sysproxy::triggerSysProxy (POS: 系统代理) ·
//         utils/dirs::coreLogPath/ensureLogDir/findSystemMihomo/logDir (POS: 应用目录与路径常量) ·
//         utils/formatUnknownErrorForLog::formatUnknownErrorForUi (POS: 未知异常序列化) ·
//         utils/icon::getIconDataURL/getImageDataURL (POS: 图标读取) ·
//         utils/log::appendAppLog/clearCachedMihomoLogs/getCachedMihomoLogs (POS: 应用日志与内核日志) ·
//         utils/notification::showNotification (POS: 应用通知) ·
//         utils/userAgent::getUserAgent (POS: 请求 User-Agent)
// [OUTPUT] registerIpcMainHandlers: 注册全部 ipcMain 通道
// [POS] 主进程 IPC 通道的统一注册入口：把渲染进程的调用路由到 config / core / sys / resolve 各模块。

import { app, ipcMain } from 'electron'
import { getUserAgent } from './userAgent'
import { SPARKLE_BUILD_STAMP, SPARKLE_SEMVER } from '../../shared/buildStamp'
import {
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoCloseConnection,
  mihomoGroupDelay,
  mihomoGroups,
  mihomoProxies,
  mihomoProxyDelay,
  mihomoProxyProviders,
  mihomoRuleProviders,
  mihomoRules,
  mihomoUnfixedProxy,
  mihomoUpdateProxyProviders,
  mihomoUpdateRuleProviders,
  mihomoUpgrade,
  mihomoUpgradeUI,
  mihomoUpgradeGeo,
  mihomoVersion,
  mihomoConfig,
  patchMihomoConfig,
  restartMihomoLogs,
  restartMihomoConnections,
  mihomoRulesDisable
} from '../core/mihomoApi'
import { isProbeWarmupActive } from '../core/probeWarmupState'
import { checkAutoRun, disableAutoRun, enableAutoRun } from '../sys/autoRun'
import {
  getAppConfig,
  patchAppConfig,
  getControledMihomoConfig,
  patchControledMihomoConfig,
  getProfileConfig,
  getCurrentProfileItem,
  getProfileItem,
  addProfileItem,
  removeProfileItem,
  changeCurrentProfile,
  getProfileStr,
  getFileStr,
  getFilePreviewStr,
  setFileStr,
  saveFileStrWithElevation,
  setProfileStr,
  updateProfileItem,
  setProfileConfig,
  getOverrideConfig,
  setOverrideConfig,
  getOverrideItem,
  addOverrideItem,
  removeOverrideItem,
  getOverride,
  setOverride,
  updateOverrideItem
} from '../config'
import {
  startSubStoreFrontendServer,
  startSubStoreBackendServer,
  stopSubStoreFrontendServer,
  stopSubStoreBackendServer,
  downloadSubStore,
  subStoreFrontendPort,
  subStorePort
} from '../resolve/server'
import {
  quitWithoutCore,
  restartCore,
  startNetworkDetection,
  stopCore,
  stopNetworkDetection
} from '../core/manager'
import {
  checkCorePermission,
  manualGrantCorePermition,
  revokeCorePermission
} from '../core/permission'
import { triggerSysProxy } from '../sys/sysproxy'
import { checkUpdate, downloadAndInstallUpdate, cancelUpdate } from '../resolve/autoUpdater'
import {
  checkElevateTask,
  deleteElevateTask,
  getFilePath,
  openFile,
  openUWPTool,
  readImageFileDataURL,
  readTextFile,
  resetAppConfig,
  setNativeTheme,
  setupFirewall
} from '../sys/misc'
import {
  serviceStatus,
  installService,
  uninstallService,
  startService,
  stopService,
  initService,
  testServiceConnection,
  restartService
} from '../service/manager'
import { patchCoreProfile } from '../service/api'
import { coreLogPath, ensureLogDir, findSystemMihomo, logDir } from './dirs'
import {
  getRuntimeConfig,
  getRuntimeConfigStr,
  getRawProfileStr,
  getCurrentProfileStr,
  getOverrideProfileStr
} from '../core/factory'
import { listWebdavBackups, webdavBackup, webdavDelete, webdavRestore } from '../resolve/backup'
import { getInterfaces } from '../sys/interface'
import {
  closeTrayIcon,
  copyEnv,
  setDockVisible,
  showTrayIcon,
  updateTrayIcon
} from '../resolve/tray'
import { registerShortcut } from '../resolve/shortcut'
import {
  closeMainWindow,
  mainWindow,
  setNotQuitDialog,
  showMainWindow,
  triggerMainWindow
} from '..'
import {
  applyTheme,
  fetchThemes,
  importThemes,
  readTheme,
  resolveThemes,
  writeTheme
} from '../resolve/theme'
import { subStoreCollections, subStoreSubs } from '../core/subStoreApi'
import path from 'path'
import v8 from 'v8'
import { getGistUrl } from '../resolve/gistApi'
import { getIconDataURL, getImageDataURL } from './icon'
import { startMonitor } from '../resolve/trafficMonitor'
import { closeFloatingWindow, showContextMenu, showFloatingWindow } from '../resolve/floatingWindow'
import { getAppName } from '@uruhalushia/sparkle-native'
import { showNotification } from './notification'
import { formatUnknownErrorForUi } from './formatUnknownErrorForLog'
import { appendAppLog, clearCachedMihomoLogs, getCachedMihomoLogs } from './log'

function ipcErrorWrapper<T>( // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (...args: any[]) => T | Promise<T> // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (...args: any[]) => Promise<T | { invokeError: unknown }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]) => {
    try {
      return await fn(...args)
    } catch (e) {
      return { invokeError: formatUnknownErrorForUi(e) }
    }
  }
}

import { shouldReloadProfileForAppConfigPatch } from '../core/cursorPathPrefixProfileReloadCore'

async function patchAppConfigWithServiceSync(patch: Partial<AppConfig>): Promise<AppConfig> {
  const nextConfig = await patchAppConfig(await normalizeServiceModePatch(patch))

  if (shouldReloadProfileForAppConfigPatch(patch)) {
    try {
      const { generateProfile } = await import('../core/factory')
      const { syncRuntimeConfigToCore } = await import('../core/runtimeConfigSync')
      await generateProfile()
      const reloaded = await syncRuntimeConfigToCore({ force: true })
      void appendAppLog(
        `[AppConfig]: cursorProxyAppPathPrefixes profile regenerated reloaded=${reloaded} prefixes=${JSON.stringify(nextConfig.cursorProxyAppPathPrefixes ?? [])}\n`
      )
    } catch (error) {
      void appendAppLog(`[AppConfig]: cursorProxyAppPathPrefixes profile reload failed, ${error}\n`)
    }
  }

  if (!('saveLogs' in patch || 'maxLogFileSizeMB' in patch)) {
    return nextConfig
  }

  const {
    corePermissionMode = 'elevated',
    saveLogs = true,
    maxLogFileSizeMB = 20
  } = await getAppConfig()
  if (corePermissionMode !== 'service') {
    return nextConfig
  }

  ensureLogDir()
  void patchCoreProfile({
    log_path: coreLogPath(),
    save_logs: saveLogs,
    max_log_file_size_mb: maxLogFileSizeMB
  }).catch((error) => {
    void appendAppLog(`[Service]: sync core log config failed, ${error}\n`)
  })

  return nextConfig
}

async function normalizeServiceModePatch(patch: Partial<AppConfig>): Promise<Partial<AppConfig>> {
  if (patch.sysProxy?.settingMode !== 'service') {
    return patch
  }

  const status = await serviceStatus().catch(() => 'unknown' as const)
  if (status === 'running') {
    return patch
  }

  void showNotification({ title: '服务不可用，已切换到执行命令模式' })
  return {
    ...patch,
    sysProxy: {
      ...patch.sysProxy,
      settingMode: 'exec',
      guard: false,
      guardNotify: false
    }
  }
}

export function registerIpcMainHandlers(): void {
  ipcMain.handle('mihomoVersion', ipcErrorWrapper(mihomoVersion))
  ipcMain.handle('mihomoConfig', ipcErrorWrapper(mihomoConfig))
  ipcMain.handle('mihomoCloseConnection', (_e, id) => ipcErrorWrapper(mihomoCloseConnection)(id))
  ipcMain.handle('mihomoCloseConnections', (_e, name) =>
    ipcErrorWrapper(mihomoCloseConnections)(name)
  )
  ipcMain.handle('mihomoRules', ipcErrorWrapper(mihomoRules))
  ipcMain.handle('mihomoProxies', ipcErrorWrapper(mihomoProxies))
  ipcMain.handle('mihomoGroups', ipcErrorWrapper(mihomoGroups))
  ipcMain.handle('getSparkleAgyProbeSnapshot', () =>
    ipcErrorWrapper(async () => {
      const { getSparkleAgyProbeSnapshot } = await import('../core/sparkleAgyProbeSnapshot')
      return getSparkleAgyProbeSnapshot()
    })()
  )
  ipcMain.handle('getSparkleGrokProbeSnapshot', () =>
    ipcErrorWrapper(async () => {
      const { getSparkleGrokProbeSnapshot } = await import('../core/sparkleGrokProbeSnapshot')
      return getSparkleGrokProbeSnapshot()
    })()
  )
  ipcMain.handle('mihomoProxyProviders', ipcErrorWrapper(mihomoProxyProviders))
  ipcMain.handle('mihomoUpdateProxyProviders', (_e, name) =>
    ipcErrorWrapper(mihomoUpdateProxyProviders)(name)
  )
  ipcMain.handle('mihomoRuleProviders', ipcErrorWrapper(mihomoRuleProviders))
  ipcMain.handle('mihomoUpdateRuleProviders', (_e, name) =>
    ipcErrorWrapper(mihomoUpdateRuleProviders)(name)
  )
  ipcMain.handle('mihomoChangeProxy', (_e, group, proxy, options) =>
    ipcErrorWrapper(mihomoChangeProxy)(group, proxy, options)
  )
  ipcMain.handle('mihomoUnfixedProxy', (_e, group) => ipcErrorWrapper(mihomoUnfixedProxy)(group))
  ipcMain.handle('getProbeWarmupActive', () => isProbeWarmupActive())
  ipcMain.handle('mihomoUpgradeGeo', ipcErrorWrapper(mihomoUpgradeGeo))
  ipcMain.handle('mihomoUpgradeUI', ipcErrorWrapper(mihomoUpgradeUI))
  ipcMain.handle('mihomoUpgrade', (_e, channel) => ipcErrorWrapper(mihomoUpgrade)(channel))
  ipcMain.handle('mihomoProxyDelay', (_e, proxy, url, options) =>
    ipcErrorWrapper(mihomoProxyDelay)(proxy, url, options)
  )
  ipcMain.handle('mihomoGroupDelay', (_e, group, url, options) =>
    ipcErrorWrapper(mihomoGroupDelay)(group, url, options)
  )
  ipcMain.handle('mihomoRulesDisable', (_e, rules) => ipcErrorWrapper(mihomoRulesDisable)(rules))
  ipcMain.handle('patchMihomoConfig', (_e, patch) => ipcErrorWrapper(patchMihomoConfig)(patch))
  ipcMain.handle('restartMihomoLogs', ipcErrorWrapper(restartMihomoLogs))
  ipcMain.handle('checkAutoRun', ipcErrorWrapper(checkAutoRun))
  ipcMain.handle('enableAutoRun', ipcErrorWrapper(enableAutoRun))
  ipcMain.handle('disableAutoRun', ipcErrorWrapper(disableAutoRun))
  ipcMain.handle('getAppConfig', (_e, force) => ipcErrorWrapper(getAppConfig)(force))
  ipcMain.handle('getCachedMihomoLogs', () => getCachedMihomoLogs())
  ipcMain.handle('clearCachedMihomoLogs', () => clearCachedMihomoLogs())
  ipcMain.handle('patchAppConfig', (_e, config) =>
    ipcErrorWrapper(patchAppConfigWithServiceSync)(config)
  )
  ipcMain.handle('getControledMihomoConfig', (_e, force) =>
    ipcErrorWrapper(getControledMihomoConfig)(force)
  )
  ipcMain.handle('patchControledMihomoConfig', (_e, config) =>
    ipcErrorWrapper(patchControledMihomoConfig)(config)
  )
  ipcMain.handle('getProfileConfig', (_e, force) => ipcErrorWrapper(getProfileConfig)(force))
  ipcMain.handle('setProfileConfig', (_e, config) => ipcErrorWrapper(setProfileConfig)(config))
  ipcMain.handle('getCurrentProfileItem', ipcErrorWrapper(getCurrentProfileItem))
  ipcMain.handle('getProfileItem', (_e, id) => ipcErrorWrapper(getProfileItem)(id))
  ipcMain.handle('getProfileStr', (_e, id) => ipcErrorWrapper(getProfileStr)(id))
  ipcMain.handle('getFileStr', (_e, path) => ipcErrorWrapper(getFileStr)(path))
  ipcMain.handle('getFilePreviewStr', (_e, path, format) =>
    ipcErrorWrapper(getFilePreviewStr)(path, format)
  )
  ipcMain.handle('setFileStr', (_e, path, str) => ipcErrorWrapper(setFileStr)(path, str))
  ipcMain.handle('saveFileStrWithElevation', (_e, path, str) =>
    ipcErrorWrapper(saveFileStrWithElevation)(path, str)
  )
  ipcMain.handle('setProfileStr', (_e, id, str) => ipcErrorWrapper(setProfileStr)(id, str))
  ipcMain.handle('updateProfileItem', (_e, item) => ipcErrorWrapper(updateProfileItem)(item))
  ipcMain.handle('changeCurrentProfile', (_e, id) => ipcErrorWrapper(changeCurrentProfile)(id))
  ipcMain.handle('addProfileItem', (_e, item) => ipcErrorWrapper(addProfileItem)(item))
  ipcMain.handle('removeProfileItem', (_e, id) => ipcErrorWrapper(removeProfileItem)(id))
  ipcMain.handle('getOverrideConfig', (_e, force) => ipcErrorWrapper(getOverrideConfig)(force))
  ipcMain.handle('setOverrideConfig', (_e, config) => ipcErrorWrapper(setOverrideConfig)(config))
  ipcMain.handle('getOverrideItem', (_e, id) => ipcErrorWrapper(getOverrideItem)(id))
  ipcMain.handle('addOverrideItem', (_e, item) => ipcErrorWrapper(addOverrideItem)(item))
  ipcMain.handle('removeOverrideItem', (_e, id) => ipcErrorWrapper(removeOverrideItem)(id))
  ipcMain.handle('updateOverrideItem', (_e, item) => ipcErrorWrapper(updateOverrideItem)(item))
  ipcMain.handle('getOverride', (_e, id, ext) => ipcErrorWrapper(getOverride)(id, ext))
  ipcMain.handle('setOverride', (_e, id, ext, str) => ipcErrorWrapper(setOverride)(id, ext, str))
  ipcMain.handle('restartCore', ipcErrorWrapper(restartCore))
  ipcMain.handle('stopCore', ipcErrorWrapper(stopCore))
  ipcMain.handle('restartMihomoConnections', ipcErrorWrapper(restartMihomoConnections))
  ipcMain.handle('startMonitor', (_e, detached) => ipcErrorWrapper(startMonitor)(detached))
  ipcMain.handle('triggerSysProxy', (_e, enable, onlyActiveDevice, useRegistry) =>
    ipcErrorWrapper(triggerSysProxy)(enable, onlyActiveDevice, useRegistry)
  )
  ipcMain.handle('manualGrantCorePermition', (_e, cores?: ('mihomo' | 'mihomo-alpha')[]) =>
    ipcErrorWrapper(manualGrantCorePermition)(cores)
  )
  ipcMain.handle('checkCorePermission', () => ipcErrorWrapper(checkCorePermission)())
  ipcMain.handle('revokeCorePermission', (_e, cores?: ('mihomo' | 'mihomo-alpha')[]) =>
    ipcErrorWrapper(revokeCorePermission)(cores)
  )
  ipcMain.handle('checkElevateTask', () => ipcErrorWrapper(checkElevateTask)())
  ipcMain.handle('deleteElevateTask', () => ipcErrorWrapper(deleteElevateTask)())
  ipcMain.handle('serviceStatus', () => ipcErrorWrapper(serviceStatus)())
  ipcMain.handle('testServiceConnection', () => ipcErrorWrapper(testServiceConnection)())
  ipcMain.handle('initService', () => ipcErrorWrapper(initService)())
  ipcMain.handle('installService', () => ipcErrorWrapper(installService)())
  ipcMain.handle('uninstallService', () => ipcErrorWrapper(uninstallService)())
  ipcMain.handle('startService', () => ipcErrorWrapper(startService)())
  ipcMain.handle('restartService', () => ipcErrorWrapper(restartService)())
  ipcMain.handle('stopService', () => ipcErrorWrapper(stopService)())
  ipcMain.handle('findSystemMihomo', () => findSystemMihomo())
  ipcMain.handle('getFilePath', (_e, ext, title, filterName) => getFilePath(ext, title, filterName))
  ipcMain.handle('readTextFile', (_e, filePath) => ipcErrorWrapper(readTextFile)(filePath))
  ipcMain.handle('readImageFileDataURL', (_e, filePath) =>
    ipcErrorWrapper(readImageFileDataURL)(filePath)
  )
  ipcMain.handle('getRuntimeConfigStr', ipcErrorWrapper(getRuntimeConfigStr))
  ipcMain.handle('getRawProfileStr', ipcErrorWrapper(getRawProfileStr))
  ipcMain.handle('getCurrentProfileStr', ipcErrorWrapper(getCurrentProfileStr))
  ipcMain.handle('getOverrideProfileStr', ipcErrorWrapper(getOverrideProfileStr))
  ipcMain.handle('getRuntimeConfig', ipcErrorWrapper(getRuntimeConfig))
  ipcMain.handle('downloadAndInstallUpdate', (_e, version) =>
    ipcErrorWrapper(downloadAndInstallUpdate)(version)
  )
  ipcMain.handle('checkUpdate', ipcErrorWrapper(checkUpdate))
  ipcMain.handle('cancelUpdate', ipcErrorWrapper(cancelUpdate))
  ipcMain.handle('getVersion', () => app.getVersion())
  ipcMain.handle('getBuildStamp', () => ({
    buildStamp: SPARKLE_BUILD_STAMP,
    semver: SPARKLE_SEMVER || app.getVersion()
  }))
  ipcMain.handle('platform', () => process.platform)
  ipcMain.handle('openUWPTool', ipcErrorWrapper(openUWPTool))
  ipcMain.handle('setupFirewall', ipcErrorWrapper(setupFirewall))
  ipcMain.handle('getInterfaces', getInterfaces)
  ipcMain.handle('webdavBackup', ipcErrorWrapper(webdavBackup))
  ipcMain.handle('webdavRestore', (_e, filename) => ipcErrorWrapper(webdavRestore)(filename))
  ipcMain.handle('listWebdavBackups', ipcErrorWrapper(listWebdavBackups))
  ipcMain.handle('webdavDelete', (_e, filename) => ipcErrorWrapper(webdavDelete)(filename))
  ipcMain.handle('registerShortcut', (_e, oldShortcut, newShortcut, action) =>
    ipcErrorWrapper(registerShortcut)(oldShortcut, newShortcut, action)
  )
  ipcMain.handle('startSubStoreFrontendServer', () =>
    ipcErrorWrapper(startSubStoreFrontendServer)()
  )
  ipcMain.handle('stopSubStoreFrontendServer', () => ipcErrorWrapper(stopSubStoreFrontendServer)())
  ipcMain.handle('startSubStoreBackendServer', () => ipcErrorWrapper(startSubStoreBackendServer)())
  ipcMain.handle('stopSubStoreBackendServer', () => ipcErrorWrapper(stopSubStoreBackendServer)())
  ipcMain.handle('downloadSubStore', () => ipcErrorWrapper(downloadSubStore)())

  ipcMain.handle('subStorePort', () => subStorePort)
  ipcMain.handle('subStoreFrontendPort', () => subStoreFrontendPort)
  ipcMain.handle('subStoreSubs', () => ipcErrorWrapper(subStoreSubs)())
  ipcMain.handle('subStoreCollections', () => ipcErrorWrapper(subStoreCollections)())
  ipcMain.handle('getGistUrl', ipcErrorWrapper(getGistUrl))
  ipcMain.handle('setNativeTheme', (_e, theme) => {
    setNativeTheme(theme)
  })
  ipcMain.handle('setTitleBarOverlay', (_e, overlay) =>
    ipcErrorWrapper(async (overlay): Promise<void> => {
      if (typeof mainWindow?.setTitleBarOverlay === 'function') {
        mainWindow.setTitleBarOverlay(overlay)
      }
    })(overlay)
  )
  ipcMain.handle('setAlwaysOnTop', (_e, alwaysOnTop) => {
    mainWindow?.setAlwaysOnTop(alwaysOnTop)
  })
  ipcMain.handle('isAlwaysOnTop', () => {
    return mainWindow?.isAlwaysOnTop()
  })
  ipcMain.handle('showTrayIcon', () => ipcErrorWrapper(showTrayIcon)())
  ipcMain.handle('closeTrayIcon', () => ipcErrorWrapper(closeTrayIcon)())
  ipcMain.handle('updateTrayIcon', () => ipcErrorWrapper(updateTrayIcon)())
  ipcMain.handle('setDockVisible', (_e, visible: boolean) => setDockVisible(visible))
  ipcMain.handle('showMainWindow', showMainWindow)
  ipcMain.handle('closeMainWindow', closeMainWindow)
  ipcMain.handle('triggerMainWindow', triggerMainWindow)
  ipcMain.handle('showFloatingWindow', () => ipcErrorWrapper(showFloatingWindow)())
  ipcMain.handle('closeFloatingWindow', () => ipcErrorWrapper(closeFloatingWindow)())
  ipcMain.handle('showContextMenu', () => ipcErrorWrapper(showContextMenu)())
  ipcMain.handle('openFile', (_e, type, id, ext) => openFile(type, id, ext))
  ipcMain.handle('openDevTools', () => {
    mainWindow?.webContents.openDevTools()
  })
  ipcMain.handle('createHeapSnapshot', () => {
    return v8.writeHeapSnapshot(path.join(logDir(), `${Date.now()}.heapsnapshot`))
  })
  ipcMain.handle('getUserAgent', () => ipcErrorWrapper(getUserAgent)())
  ipcMain.handle('getAppName', (_e, appPath) => ipcErrorWrapper(getAppName)(appPath))
  ipcMain.handle('getImageDataURL', (_e, url) => ipcErrorWrapper(getImageDataURL)(url))
  ipcMain.handle('getIconDataURL', (_e, appPath) => ipcErrorWrapper(getIconDataURL)(appPath))
  ipcMain.handle('resolveThemes', () => ipcErrorWrapper(resolveThemes)())
  ipcMain.handle('fetchThemes', () => ipcErrorWrapper(fetchThemes)())
  ipcMain.handle('importThemes', (_e, file) => ipcErrorWrapper(importThemes)(file))
  ipcMain.handle('readTheme', (_e, theme) => ipcErrorWrapper(readTheme)(theme))
  ipcMain.handle('writeTheme', (_e, theme, css) => ipcErrorWrapper(writeTheme)(theme, css))
  ipcMain.handle('applyTheme', (_e, theme) => ipcErrorWrapper(applyTheme)(theme))
  ipcMain.handle('copyEnv', (_e, type) => ipcErrorWrapper(copyEnv)(type))
  ipcMain.handle('alert', (_e, msg) => {
    void showNotification({ title: 'Sparkle', body: msg, variant: 'danger' })
  })
  ipcMain.handle('resetAppConfig', resetAppConfig)
  ipcMain.handle('relaunchApp', () => {
    setNotQuitDialog()
    app.relaunch()
    app.quit()
  })
  ipcMain.handle('quitWithoutCore', ipcErrorWrapper(quitWithoutCore))
  ipcMain.handle('startNetworkDetection', ipcErrorWrapper(startNetworkDetection))
  ipcMain.handle('stopNetworkDetection', ipcErrorWrapper(stopNetworkDetection))
  ipcMain.handle('quitApp', () => app.quit())
  ipcMain.handle('notDialogQuit', () => {
    setNotQuitDialog()
    app.quit()
  })
}
