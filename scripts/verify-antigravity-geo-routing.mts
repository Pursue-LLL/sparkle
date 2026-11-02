#!/usr/bin/env tsx
/**
 * Post-deploy gate: the Antigravity (agy / cloudcode-pa) traffic must land in the
 * dedicated `🎯 agy 专用` select group — whose members come from the `sparkle-agy`
 * provider, i.e. only nodes that passed a real agy request (HTTP 200).
 *
 * Background: gemini.google.com reachability is NOT a proxy for Code Assist
 * availability — cloudcode-pa evaluates the region only after authentication
 * (an unauthenticated call returns 401), so the Gemini probe can never filter
 * these nodes. See src/main/core/sparkleAgyProbe.ts.
 *
 * Usage: tsx scripts/verify-antigravity-geo-routing.mts [--config path]
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)
const configArgIdx = args.indexOf('--config')
const configPath =
  configArgIdx >= 0 && args[configArgIdx + 1]
    ? args[configArgIdx + 1]
    : (process.env.SPARKLE_WORK_CONFIG ??
      join(homedir(), 'Library/Application Support/sparkle/work/config.yaml'))

const GROUP_NAME = '🎯 agy 专用'
const PROVIDER_ID = 'sparkle-agy'
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
  failures.push(`target group missing: ${GROUP_NAME}`)
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
    ['group type select', 'type: select'],
    ['group uses agy provider', `- ${PROVIDER_ID}`]
  ] as const) {
    if (!groupText.includes(needle)) {
      failures.push(`${label} missing in ${GROUP_NAME} block`)
    }
  }
}

const providerIdx = lines.findIndex((line) => line.trim() === `${PROVIDER_ID}:`)
if (providerIdx < 0) {
  failures.push(`proxy-provider missing: ${PROVIDER_ID}`)
}

const providerPath = join(dirname(configPath), '..', 'profiles', 'sparkle-agy-proxies.yaml')
if (!existsSync(providerPath)) {
  failures.push(`agy provider file missing: ${providerPath}`)
} else {
  const providerText = readFileSync(providerPath, 'utf8')
  if (!/^\s*-\s+name:/m.test(providerText)) {
    failures.push('agy provider file has no nodes (mihomo would reject an empty provider)')
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
console.log(`  target group: ${GROUP_NAME} (select, provider ${PROVIDER_ID})`)
for (const [base, idx] of ruleIdxByBase) {
  console.log(`  rule line ${String(idx + 1).padStart(5)}: ${base},${GROUP_NAME}`)
}
console.log(`  generic googleapis rule line ${String(genericIdx + 1).padStart(5)} (injected rules beat it)`)
