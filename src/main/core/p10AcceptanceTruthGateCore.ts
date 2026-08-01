// [INPUT] package.json paths · validated ledger lines · Cursor extension roots
// [OUTPUT] runP10AcceptanceTruthGate
// [POS] Gate A — structured runtime truth for third-party acceptance (no rg fuzzy counts).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface P10AcceptanceTruthGateInput {
  sparklePackageJsonPath: string
  guardPackageJsonPath: string
  validatedLedgerPath: string
  cursorProfileExtensionRoots: readonly string[]
  sparkleAppInfoPath?: string
}

export interface P10LedgerEventKindCounts {
  httpSegmentStarted: number
  networkStarted: number
  streamTerminated: number
  parseErrors: number
}

export interface P10AcceptanceTruthGateResult {
  ok: boolean
  cases: Array<{ name: string; ok: boolean; detail: string }>
  ledgerCounts: P10LedgerEventKindCounts
  sparklePackageVersion?: string
  guardPackageVersion?: string
  installedSparkleVersion?: string
  installedGuardVersions: string[]
}

export function readPackageVersion(packageJsonPath: string): string | undefined {
  if (!existsSync(packageJsonPath)) {
    return undefined
  }
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }
    return parsed.version?.trim() || undefined
  } catch {
    return undefined
  }
}

export function readSparkleAppVersion(infoPlistPath: string): string | undefined {
  if (!existsSync(infoPlistPath)) {
    return undefined
  }
  const text = readFileSync(infoPlistPath, 'utf8')
  const match = text.match(
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
  )
  return match?.[1]?.trim()
}

export function discoverInstalledGuardVersions(extensionRoots: readonly string[]): string[] {
  const versions = new Set<string>()
  for (const root of extensionRoots) {
    if (!existsSync(root)) {
      continue
    }
    for (const entry of readDirSafe(root)) {
      if (!entry.startsWith('cursor-usage-watch-')) {
        continue
      }
      const pkgPath = join(root, entry, 'package.json')
      const version = readPackageVersion(pkgPath)
      if (version) {
        versions.add(version)
      }
    }
  }
  return [...versions].sort()
}

function readDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function countValidatedLedgerEventKinds(lines: readonly string[]): P10LedgerEventKindCounts {
  const counts: P10LedgerEventKindCounts = {
    httpSegmentStarted: 0,
    networkStarted: 0,
    streamTerminated: 0,
    parseErrors: 0,
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed) as {
        envelope?: { eventKind?: string }
        eventKind?: string
      }
      const eventKind = parsed.envelope?.eventKind ?? parsed.eventKind
      if (eventKind === 'http_segment_started') {
        counts.httpSegmentStarted += 1
      } else if (eventKind === 'network_started') {
        counts.networkStarted += 1
      } else if (eventKind === 'stream_terminated') {
        counts.streamTerminated += 1
      }
    } catch {
      counts.parseErrors += 1
    }
  }
  return counts
}

export function collectUniqueNetworkStartIds(lines: readonly string[]): Set<string> {
  const ids = new Set<string>()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed) as {
        envelope?: {
          eventKind?: string
          payload?: { networkStartId?: string }
          networkStartId?: string
        }
      }
      const envelope = parsed.envelope
      if (!envelope || envelope.eventKind !== 'network_started') {
        continue
      }
      const networkStartId = String(
        envelope.payload?.networkStartId ?? envelope.networkStartId ?? '',
      ).trim()
      if (networkStartId) {
        ids.add(networkStartId)
      }
    } catch {
      continue
    }
  }
  return ids
}

export function runP10AcceptanceTruthGate(input: P10AcceptanceTruthGateInput): P10AcceptanceTruthGateResult {
  const cases: P10AcceptanceTruthGateResult['cases'] = []
  const sparklePackageVersion = readPackageVersion(input.sparklePackageJsonPath)
  const guardPackageVersion = readPackageVersion(input.guardPackageJsonPath)
  const installedSparkleVersion = input.sparkleAppInfoPath
    ? readSparkleAppVersion(input.sparkleAppInfoPath)
    : undefined
  const installedGuardVersions = discoverInstalledGuardVersions(input.cursorProfileExtensionRoots)

  cases.push({
    name: 'sparkle_package_version_readable',
    ok: Boolean(sparklePackageVersion),
    detail: sparklePackageVersion ?? 'missing sparkle package.json version',
  })
  cases.push({
    name: 'guard_package_version_readable',
    ok: Boolean(guardPackageVersion),
    detail: guardPackageVersion ?? 'missing guard package.json version',
  })

  let ledgerLines: string[] = []
  if (existsSync(input.validatedLedgerPath)) {
    ledgerLines = readFileSync(input.validatedLedgerPath, 'utf8').split('\n')
  }
  const ledgerCounts = countValidatedLedgerEventKinds(ledgerLines)
  const networkStartIds = collectUniqueNetworkStartIds(ledgerLines)

  cases.push({
    name: 'ledger_event_kind_structured_count',
    ok: ledgerLines.length > 0,
    detail: `http_segment=${ledgerCounts.httpSegmentStarted} network_started=${ledgerCounts.networkStarted} terminal=${ledgerCounts.streamTerminated}`,
  })

  cases.push({
    name: 'network_started_not_confused_with_http_segment',
    ok:
      ledgerCounts.networkStarted === 0 ||
      ledgerCounts.networkStarted <= ledgerCounts.httpSegmentStarted,
    detail: `network_started=${ledgerCounts.networkStarted} http_segment=${ledgerCounts.httpSegmentStarted}`,
  })

  cases.push({
    name: 'deploy_candidate_requires_network_started_when_http_segments_exist',
    ok: ledgerCounts.httpSegmentStarted === 0 || ledgerCounts.networkStarted > 0,
    detail:
      ledgerCounts.httpSegmentStarted > 0 && ledgerCounts.networkStarted === 0
        ? 'bad_ruler_no_network_started'
        : 'ok',
  })

  cases.push({
    name: 'network_start_ids_unique_when_present',
    ok: ledgerCounts.networkStarted === 0 || networkStartIds.size === ledgerCounts.networkStarted,
    detail: `unique_ids=${networkStartIds.size} network_started=${ledgerCounts.networkStarted}`,
  })

  if (installedSparkleVersion && sparklePackageVersion) {
    cases.push({
      name: 'sparkle_deploy_version_matches_candidate',
      ok: installedSparkleVersion === sparklePackageVersion,
      detail: `installed=${installedSparkleVersion} candidate=${sparklePackageVersion}`,
    })
  }

  if (guardPackageVersion && installedGuardVersions.length > 0) {
    cases.push({
      name: 'guard_deploy_version_matches_candidate',
      ok: installedGuardVersions.includes(guardPackageVersion),
      detail: `installed=${installedGuardVersions.join(',')} candidate=${guardPackageVersion}`,
    })
  }

  return {
    ok: cases.every((item) => item.ok),
    cases,
    ledgerCounts,
    sparklePackageVersion,
    guardPackageVersion,
    installedSparkleVersion,
    installedGuardVersions,
  }
}

export function defaultP10AcceptanceTruthGateInput(
  sparkleRoot: string,
  guardPackageJsonPath: string,
): P10AcceptanceTruthGateInput {
  const home = homedir()
  return {
    sparklePackageJsonPath: join(sparkleRoot, 'package.json'),
    guardPackageJsonPath,
    validatedLedgerPath: join(home, '.cursor-500-guard', 'runtime-events', 'validated-ledger.v1.jsonl'),
    cursorProfileExtensionRoots: [
      join(home, '.cursor-3.1.15', 'extensions'),
      join(home, '.cursor', 'extensions'),
    ],
    sparkleAppInfoPath: '/Applications/Sparkle.app/Contents/Info.plist',
  }
}
