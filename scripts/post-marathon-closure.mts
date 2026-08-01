#!/usr/bin/env tsx
/** Marathon idle-window closure — upgrade Sparkle, preflight, optional G9 strict soak gate. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const EXPECTED_VER = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string
const INSTALLED_VER = spawnSync(
  'defaults',
  ['read', '/Applications/Sparkle.app/Contents/Info.plist', 'CFBundleShortVersionString'],
  { encoding: 'utf8' },
).stdout.trim()

function run(label: string, cmd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  console.log(`[PostMarathon] ${label}: ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function stepP10CodeGate(): void {
  run('p10-code-gate', path.join(ROOT, 'node_modules/.bin/tsx'), ['scripts/p10CodeGate.mts'])
}

function stepPreflight(): void {
  run('preflight', 'bash', ['scripts/preflight-sparkle-1280.sh'])
}

function stepUpgrade(): void {
  run('upgrade', 'bash', ['scripts/upgrade-sparkle-local.sh'])
}

function stepG9Once(): void {
  run('g9-once', path.join(ROOT, 'node_modules/.bin/tsx'), ['scripts/g9-soak-monitor.mts'])
}

function stepG9Strict(durationMin: number): void {
  const deadline = Date.now() + durationMin * 60_000
  console.log(`[PostMarathon] G9 strict soak ${durationMin}min until ${new Date(deadline).toISOString()}`)
  while (Date.now() < deadline) {
    run('g9-strict-tick', path.join(ROOT, 'node_modules/.bin/tsx'), ['scripts/g9-soak-monitor.mts'], {
      G9_SOAK_STRICT: '1',
    })
    spawnSync('sleep', ['120'])
  }
}

function main(): void {
  const mode = process.argv[2] ?? 'full'
  console.log(`[PostMarathon] mode=${mode} installed=${INSTALLED_VER || 'unknown'} expected=${EXPECTED_VER}`)

  if (mode === 'p10-code-gate') {
    stepP10CodeGate()
    return
  }

  if (mode === 'preflight-only') {
    stepPreflight()
    return
  }

  if (mode === 'g9-once') {
    stepG9Once()
    return
  }

  if (mode === 'g9-strict') {
    stepG9Strict(Number(process.env.G9_SOAK_MINUTES ?? '40'))
    return
  }

  const distApp = path.join(ROOT, 'dist/mac-arm64/Sparkle.app')
  if (INSTALLED_VER !== EXPECTED_VER || !existsSync(distApp)) {
    stepUpgrade()
  } else {
    console.log(`[PostMarathon] skip upgrade — Sparkle ${INSTALLED_VER} matches package.json`)
  }

  stepP10CodeGate()
  stepPreflight()

  if (process.env.G9_SOAK_STRICT === '1') {
    stepG9Strict(Number(process.env.G9_SOAK_MINUTES ?? '40'))
  } else {
    stepG9Once()
  }

  console.log('[PostMarathon] DONE — next: Cursor Developer Reload Window (extension 0.16.34)')
  console.log(`[PostMarathon] guard patch: ${path.join(homedir(), '.cursor-500-guard/patch-applied.json')}`)
}

main()
