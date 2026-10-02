#!/usr/bin/env tsx
/**
 * Post-deploy gate: the Antigravity (agy CLI) geo-routing fix must be live in the
 * active mihomo work config — dedicated VPS fallback group plus injected rules
 * ordered above the subscription's generic `DOMAIN-SUFFIX,googleapis.com` rule
 * (upstream 400 FAILED_PRECONDITION "User location is not supported").
 * Usage: tsx scripts/verify-antigravity-geo-routing.mts [--config path]
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const configArgIdx = args.indexOf('--config')
const configPath =
  configArgIdx >= 0 && args[configArgIdx + 1]
    ? args[configArgIdx + 1]
    : (process.env.SPARKLE_WORK_CONFIG ??
      join(homedir(), 'Library/Application Support/sparkle/work/config.yaml'))

const GROUP_NAME = '🎯 Antigravity 专用'
const RULE_BASES = [
  'DOMAIN-KEYWORD,cloudcode-pa',
  'DOMAIN-SUFFIX,aicode.googleapis.com',
  'DOMAIN-SUFFIX,generativelanguage.googleapis.com'
] as const
const GENERIC_GOOGLEAPIS_PREFIX = '- DOMAIN-SUFFIX,googleapis.com,'

if (!existsSync(configPath)) {
  console.error(`FAIL: work config not found: ${configPath}`)
  console.error('      (deploy first: pnpm run agent:upgrade:mac, then re-run this gate)')
  process.exit(1)
}

const lines = readFileSync(configPath, 'utf8').split('\n')
const failures: string[] = []

const groupLineIdx = lines.findIndex((line) => line.trim() === `- name: ${GROUP_NAME}`)
if (groupLineIdx < 0) {
  failures.push(`dedicated group missing: ${GROUP_NAME}`)
} else {
  const groupBlock: string[] = []
  for (const line of lines.slice(groupLineIdx + 1)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- name:')) {
      break
    }
    groupBlock.push(trimmed)
  }
  const groupText = groupBlock.join('\n')
  for (const [label, needle] of [
    ['group type fallback', 'type: fallback'],
    ['group probe gemini.google.com', 'url: https://gemini.google.com'],
    ['group uses VPS provider', 'use:'],
    ['group VPS leaf filter', 'filter: (?i)-VPS-(Reality|HY2)$']
  ] as const) {
    if (!groupText.includes(needle)) {
      failures.push(`${label} missing in ${GROUP_NAME} block`)
    }
  }
}

const ruleIdxByBase = new Map<string, number>()
for (const base of RULE_BASES) {
  const idx = lines.findIndex((line) => line.trim() === `- ${base},${GROUP_NAME}`)
  ruleIdxByBase.set(base, idx)
  if (idx < 0) {
    failures.push(`rule missing: ${base},${GROUP_NAME}`)
  }
}

const genericIdx = lines.findIndex(
  (line) => line.trim().startsWith(GENERIC_GOOGLEAPIS_PREFIX) && !line.trim().includes(GROUP_NAME)
)
if (genericIdx < 0) {
  failures.push('generic DOMAIN-SUFFIX,googleapis.com rule not found (unexpected template)')
} else {
  for (const base of RULE_BASES) {
    const idx = ruleIdxByBase.get(base) ?? -1
    if (idx >= 0 && idx > genericIdx) {
      failures.push(`rule ordered BELOW generic googleapis rule: ${base},${GROUP_NAME}`)
    }
  }
}

if (failures.length > 0) {
  console.error(`FAIL: antigravity geo-routing not sealed (${failures.length} issue(s)):`)
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exit(1)
}

console.log('PASS: antigravity geo-routing sealed')
console.log(`  group: ${GROUP_NAME} (fallback, VPS provider, Reality|HY2)`)
for (const [base, idx] of ruleIdxByBase) {
  console.log(`  rule line ${String(idx + 1).padStart(5)}: ${base},${GROUP_NAME}`)
}
console.log(`  generic googleapis rule line ${String(genericIdx + 1).padStart(5)} (injected rules beat it)`)
