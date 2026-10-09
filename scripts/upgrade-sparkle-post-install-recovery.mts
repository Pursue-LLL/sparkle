#!/usr/bin/env -S node --import tsx
/** Post-install recovery — socket hygiene + GUI relaunch when mihomo bootstrap fails. */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  countPostCoreBootstrapNotReachableSinceLine,
  hasApi2ProbePlaneSettledSinceLine,
  hasMihomoApiReadySinceLine,
} from './upgradeSparklePostInstallGateCore'

const ROOT = join(import.meta.dirname, '..')
const LOG_DIR = join(homedir(), 'Library/Application Support/sparkle/logs')

function latestAppLogPath(): string | null {
  if (!existsSync(LOG_DIR)) {
    return null
  }
  const candidates = readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('app-') && name.endsWith('.log'))
    .map((name) => join(LOG_DIR, name))
    .filter((path) => existsSync(path))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  return candidates[0] ?? null
}

function readPostInstallState(sinceLine: number): {
  mihomoApiReady: boolean
  api2ProbePlaneSettled: boolean
  notReachableCount: number
} {
  const appLog = latestAppLogPath()
  if (!appLog) {
    return { mihomoApiReady: false, api2ProbePlaneSettled: false, notReachableCount: 0 }
  }
  const text = readFileSync(appLog, 'utf8')
  return {
    mihomoApiReady: hasMihomoApiReadySinceLine(text, sinceLine),
    api2ProbePlaneSettled: hasApi2ProbePlaneSettledSinceLine(text, sinceLine),
    notReachableCount: countPostCoreBootstrapNotReachableSinceLine(text, sinceLine),
  }
}

function runShell(command: string): void {
  execFileSync('bash', ['-lc', command], { stdio: 'inherit' })
}

async function main(): Promise<void> {
  const sinceLine = Number(process.argv[2] ?? '0')
  const round = Number(process.argv[3] ?? '1')
  console.error(`[upgrade-post-install-recovery] round=${round} since_line=${sinceLine}`)

  runShell('pgrep -x Sparkle >/dev/null 2>&1 && osascript -e \'tell application "Sparkle" to quit\' || true')
  await delay(3000)
  runShell('pgrep -x Sparkle >/dev/null 2>&1 && pkill -x Sparkle || true')
  await delay(2000)

  execFileSync(`${ROOT}/node_modules/.bin/tsx`, [`${ROOT}/scripts/sparkle-stale-mihomo-socket-hygiene.mts`], {
    stdio: 'inherit',
  })

  execFileSync(
    'osascript',
    ['-e', 'tell application "Finder" to open POSIX file "/Applications/Sparkle.app"'],
    { stdio: 'inherit' },
  )
  await delay(8000)

  const waitSec = Number(process.env.SPARKLE_POST_INSTALL_RECOVERY_WAIT_SEC ?? 60)
  const deadlineMs = Date.now() + waitSec * 1000
  while (Date.now() < deadlineMs) {
    const state = readPostInstallState(sinceLine)
    if (state.mihomoApiReady && state.api2ProbePlaneSettled) {
      console.error('[upgrade-post-install-recovery] ok=1 mihomo_api_ready=1 api2_probe=1')
      return
    }
    await delay(5000)
  }

  const finalState = readPostInstallState(sinceLine)
  console.error(
    `[upgrade-post-install-recovery] ok=0 mihomo_api_ready=${finalState.mihomoApiReady ? 1 : 0} api2_probe=${finalState.api2ProbePlaneSettled ? 1 : 0}`,
  )
  process.exit(1)
}

void main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[upgrade-post-install-recovery] FAIL: ${msg}`)
  process.exit(1)
})
