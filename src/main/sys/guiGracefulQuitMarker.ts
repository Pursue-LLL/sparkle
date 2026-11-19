// [INPUT] guiWatchdogCore::gracefulQuitMarkerPath/guiCrashLedgerPath/buildCrashLedgerLine/GuiCrashLedgerEntry (POS: GUI 看门狗的路径常量与纯判定)
// [OUTPUT] markGracefulGuiQuit · appendGuiCrashLedger
// [POS] GUI 正常退出标记与崩溃台账的落盘：GUI 主动退出时写 `~/.sparkle/gui-graceful-quit.stamp`，看门狗（`scripts/sparkle-gui-watchdog.sh`）读到它就不重新拉起 GUI。

import { appendFileSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import {
  buildCrashLedgerLine,
  gracefulQuitMarkerPath,
  guiCrashLedgerPath,
  type GuiCrashLedgerEntry
} from './guiWatchdogCore'

function ensureStateDir(): void {
  mkdirSync(`${homedir()}/.sparkle`, { recursive: true })
}

export function markGracefulGuiQuit(): void {
  ensureStateDir()
  writeFileSync(gracefulQuitMarkerPath(homedir()), `${Date.now()}\n`, 'utf8')
}

export function appendGuiCrashLedger(entry: GuiCrashLedgerEntry): void {
  ensureStateDir()
  appendFileSync(guiCrashLedgerPath(homedir()), buildCrashLedgerLine(entry), 'utf8')
}
