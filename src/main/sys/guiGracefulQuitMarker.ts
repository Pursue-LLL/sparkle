import { appendFileSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import {
  buildCrashLedgerLine,
  gracefulQuitMarkerPath,
  guiCrashLedgerPath,
  type GuiCrashLedgerEntry,
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
