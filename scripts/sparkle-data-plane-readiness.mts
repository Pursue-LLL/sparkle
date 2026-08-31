#!/usr/bin/env tsx
/** Data-plane readiness probe — SSOT for agent-sparkle-upgrade post-install gate. */
import { execFileSync } from 'node:child_process'

const MAX_ATTEMPTS = Number(process.env.SPARKLE_DATA_PLANE_ATTEMPTS ?? '20')
const SLEEP_SEC = Number(process.env.SPARKLE_DATA_PLANE_SLEEP_SEC ?? '2')
const PROXY_URL = process.env.SPARKLE_PROXY_URL ?? 'http://127.0.0.1:7890'
const TARGET_URL = process.env.SPARKLE_DATA_PLANE_TARGET ?? 'https://api2.cursor.sh/'

function sleep(seconds: number): void {
  execFileSync('sleep', [String(seconds)])
}

function probeProxy(): boolean {
  try {
    execFileSync(
      'curl',
      ['-sf', '--max-time', '8', '-x', PROXY_URL, '-o', '/dev/null', TARGET_URL],
      { stdio: 'ignore' },
    )
    return true
  } catch {
    return false
  }
}

function probeMihomoPid(): boolean {
  try {
    const out = execFileSync('pgrep', ['-lf', 'sidecar/mihomo'], { encoding: 'utf8' })
    return out.trim().length > 0
  } catch {
    return false
  }
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const pidOk = probeMihomoPid()
  const proxyOk = probeProxy()
  if (pidOk && proxyOk) {
    console.log(
      `[sparkle-data-plane-readiness] OK attempt=${attempt} mihomo=1 proxy=1 target=${TARGET_URL}`,
    )
    process.exit(0)
  }
  console.error(
    `[sparkle-data-plane-readiness] waiting attempt=${attempt}/${MAX_ATTEMPTS} mihomo=${pidOk ? 1 : 0} proxy=${proxyOk ? 1 : 0}`,
  )
  if (attempt < MAX_ATTEMPTS) {
    sleep(SLEEP_SEC)
  }
}

console.error('[sparkle-data-plane-readiness] FAIL: data plane not ready')
process.exit(1)
