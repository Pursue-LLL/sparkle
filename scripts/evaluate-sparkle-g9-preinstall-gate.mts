#!/usr/bin/env -S node --import tsx
/** G9 pre-install gate — block upgrade when rolling attempt SLO is below target; remedial path for active incidents. */

import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { evaluateMaxStepsRateUpgradeGate } from './maxStepsRateUpgradeGateCore'
import {
  evaluateRemedialG9Upgrade,
  parseUpgradeIncidentRegistry,
  REMEDIAL_G9_INCIDENT_REGISTRY_RELATIVE,
  type UpgradeIncidentRegistry,
} from './upgradeSafeWindowCore'

function pickLastMatching(text: string, prefix: string): string | null {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line.includes(prefix)) {
      return line
    }
  }
  return null
}

function readSnapshotAttemptRatePct(): number | null {
  const snapshotPath = join(homedir(), '.sparkle', 'max-steps-rate-snapshot.jsonl')
  if (!existsSync(snapshotPath)) {
    return null
  }
  const tail = readFileSync(snapshotPath, 'utf8').trim().split('\n').at(-1)
  if (!tail) {
    return null
  }
  try {
    const parsed = JSON.parse(tail) as {
      attempt?: { primary?: { attemptRatePct?: number } }
    }
    return typeof parsed.attempt?.primary?.attemptRatePct === 'number'
      ? parsed.attempt.primary.attemptRatePct
      : null
  } catch {
    return null
  }
}

function readLatestAppLogTail(): string {
  const logDir = join(homedir(), 'Library/Application Support/sparkle/logs')
  if (!existsSync(logDir)) {
    return ''
  }
  try {
    const candidates = readdirSync(logDir)
      .filter((name) => name.startsWith('app-') && name.endsWith('.log'))
      .map((name) => join(logDir, name))
      .filter((path) => existsSync(path))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    if (!candidates[0]) {
      return ''
    }
    const text = readFileSync(candidates[0], 'utf8')
    return text.slice(Math.max(0, text.length - 512_000))
  } catch {
    return ''
  }
}

function readInstalledSparkleVersion(): string | null {
  const plist = '/Applications/Sparkle.app/Contents/Info.plist'
  if (!existsSync(plist)) {
    return null
  }
  try {
    const version = execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print CFBundleShortVersionString', plist],
      { encoding: 'utf8' },
    ).trim()
    return version || null
  } catch {
    return null
  }
}

function ensureIncidentRegistry(): void {
  const registryPath = join(homedir(), REMEDIAL_G9_INCIDENT_REGISTRY_RELATIVE)
  if (existsSync(registryPath)) {
    return
  }
  const defaultPath = join(import.meta.dirname, 'assets/upgrade-incident-registry.default.json')
  if (!existsSync(defaultPath)) {
    return
  }
  copyFileSync(defaultPath, registryPath)
}

function readIncidentRegistry(): UpgradeIncidentRegistry {
  ensureIncidentRegistry()
  const registryPath = join(homedir(), REMEDIAL_G9_INCIDENT_REGISTRY_RELATIVE)
  if (!existsSync(registryPath)) {
    return parseUpgradeIncidentRegistry(null)
  }
  try {
    return parseUpgradeIncidentRegistry(JSON.parse(readFileSync(registryPath, 'utf8')))
  } catch {
    return parseUpgradeIncidentRegistry(null)
  }
}

function main(): void {
  if (process.env.SPARKLE_UPGRADE_SKIP_G9_GATE === '1') {
    console.error('[G9PreInstallGate] skip=1 reason=SPARKLE_UPGRADE_SKIP_G9_GATE (deprecated — use remedial registry)')
    return
  }

  const targetVersion =
    process.env.SPARKLE_UPGRADE_TARGET_VERSION ??
    JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version
  const appLogTail = readLatestAppLogTail()
  const maxStepsLogLine = pickLastMatching(appLogTail, '[MaxStepsRate]:')
  const snapshotAttemptRatePct = readSnapshotAttemptRatePct()
  const gate = evaluateMaxStepsRateUpgradeGate({
    maxStepsLogLine,
    snapshotAttemptRatePct,
    advisoryOnly: process.env.SPARKLE_UPGRADE_G9_ADVISORY === '1',
  })

  if (!gate.allowUpgrade) {
    const remedial = evaluateRemedialG9Upgrade({
      gateBlocked: true,
      gateReason: gate.reason,
      installedVersion: readInstalledSparkleVersion(),
      targetVersion: targetVersion || '',
      registry: readIncidentRegistry(),
    })
    if (remedial.allowRemedial) {
      console.error(`[G9PreInstallGate] allow=1 remedial=1 ${remedial.auditReason}`)
      return
    }
  }

  console.error(
    `[G9PreInstallGate] allow=${gate.allowUpgrade ? 1 : 0} reason=${gate.reason}` +
      ` attempts_started=${gate.attemptsStarted ?? 'unknown'}` +
      ` attempt_rate_pct=${gate.attemptRatePct ?? 'missing'}`,
  )

  if (!gate.allowUpgrade) {
    process.exit(1)
  }
}

main()
