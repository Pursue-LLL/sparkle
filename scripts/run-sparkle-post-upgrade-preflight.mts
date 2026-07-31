#!/usr/bin/env tsx
/** CLI for preflight-sparkle-1280.sh — avoids ARG_MAX from inlined asar bundle text. */
import { readFileSync } from 'node:fs'
import { collectSparkleMainProcessAsarSource } from './sparkleMainAsarSourceCore.ts'
import {
  evaluateSparklePostUpgradePreflight,
  formatSparklePostUpgradePreflightReport,
} from './sparklePostUpgradePreflightCore.ts'

function readOptional(path: string | undefined): string {
  if (!path) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const installedVersion = process.argv[2] ?? 'unknown'
const expectedVersion = process.argv[3] ?? 'unknown'
const appAsarPath = process.argv[4] ?? ''
const appLogPath = process.argv[5] ?? ''
const guardPatchPath = process.argv[6] ?? ''
const configYamlPath = process.argv[7] ?? ''
const mihomoCloseSmokeOk = process.argv[8] === 'true'

let mainAsarSource = ''
if (appAsarPath) {
  try {
    mainAsarSource = collectSparkleMainProcessAsarSource(appAsarPath)
  } catch (err) {
    console.error(
      `[run-sparkle-post-upgrade-preflight] ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }
}

const appLogFull = readOptional(appLogPath)
const appLogTail = appLogFull ? appLogFull.split('\n').slice(-200).join('\n') : ''

const result = evaluateSparklePostUpgradePreflight({
  installedVersion,
  expectedVersion,
  mainAsarSource,
  appLogTail,
  guardPatchAppliedJson: readOptional(guardPatchPath),
  sparkleConfigYaml: readOptional(configYamlPath),
  mihomoCloseSmokeOk,
})

console.log(formatSparklePostUpgradePreflightReport(result))
process.exit(result.ok ? 0 : 1)
