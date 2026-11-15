#!/usr/bin/env -S node --import tsx
// [INPUT] scripts/upgradeSparklePostInstallGateCore.ts (POS: 只评估安装行偏移之后的 app 日志行，判定内核引导
//         是否就绪或失败) · scripts/sparkle-stale-mihomo-socket-hygiene.mts (POS: 探测失败时清掉僵尸
//         /tmp/sparkle-mihomo-api.sock) · app 日志 app-*.log · 参数 <sinceLine> [round] ·
//         SPARKLE_POST_INSTALL_RECOVERY_WAIT_SEC
// [OUTPUT] 一轮恢复：SIGTERM 停 GUI → socket 卫生 → 经 Finder 重新启动 → 等 mihomo API 就绪；
//          退出码 0 = 已就绪，1 = 超时或异常
// [POS] 装后内核引导失败时的恢复；默认不自动调用，仅当 upgrade-sparkle-local.sh 显式放开恢复轮次时使用。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  countPostCoreBootstrapNotReachableSinceLine,
  hasMihomoApiReadySinceLine
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
  notReachableCount: number
} {
  const appLog = latestAppLogPath()
  if (!appLog) {
    return { mihomoApiReady: false, notReachableCount: 0 }
  }
  const text = readFileSync(appLog, 'utf8')
  return {
    mihomoApiReady: hasMihomoApiReadySinceLine(text, sinceLine),
    notReachableCount: countPostCoreBootstrapNotReachableSinceLine(text, sinceLine)
  }
}

function runShell(command: string): void {
  execFileSync('bash', ['-lc', command], { stdio: 'inherit' })
}

async function main(): Promise<void> {
  const sinceLine = Number(process.argv[2] ?? '0')
  const round = Number(process.argv[3] ?? '1')
  console.error(`[upgrade-post-install-recovery] round=${round} since_line=${sinceLine}`)

  // AppleEvent「quit」与 SIGTERM 都会走 App 的 before-quit（appLifecycle.ts）：没有升级静默标记时它
  // 会弹出等人点的确认框，这里没有人会点，所以停 GUI 只是尽力而为，不保证退出、也不强杀；
  // 重启是否真的生效，以随后 mihomo API 就绪为准（超时则退出码 1）。
  runShell('pgrep -x Sparkle >/dev/null 2>&1 && pkill -x Sparkle || true')
  await delay(2000)

  execFileSync(
    `${ROOT}/node_modules/.bin/tsx`,
    [`${ROOT}/scripts/sparkle-stale-mihomo-socket-hygiene.mts`],
    {
      stdio: 'inherit'
    }
  )

  execFileSync(
    'osascript',
    ['-e', 'tell application "Finder" to open POSIX file "/Applications/Sparkle.app"'],
    { stdio: 'inherit' }
  )
  await delay(8000)

  const waitSec = Number(process.env.SPARKLE_POST_INSTALL_RECOVERY_WAIT_SEC ?? 60)
  const deadlineMs = Date.now() + waitSec * 1000
  while (Date.now() < deadlineMs) {
    const state = readPostInstallState(sinceLine)
    if (state.mihomoApiReady) {
      console.error('[upgrade-post-install-recovery] ok=1 mihomo_api_ready=1')
      return
    }
    await delay(5000)
  }

  const finalState = readPostInstallState(sinceLine)
  console.error(
    `[upgrade-post-install-recovery] ok=0 mihomo_api_ready=${finalState.mihomoApiReady ? 1 : 0}`
  )
  process.exit(1)
}

void main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[upgrade-post-install-recovery] FAIL: ${msg}`)
  process.exit(1)
})
