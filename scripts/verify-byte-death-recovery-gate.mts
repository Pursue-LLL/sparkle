#!/usr/bin/env tsx
/**
 * Post-upgrade gate: fail if marathon global byte-death persists without R2 recovery.
 * Usage: tsx scripts/verify-byte-death-recovery-gate.mts [--log path] [--minutes N]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const logArgIdx = args.indexOf('--log')
const minArgIdx = args.indexOf('--minutes')
const watchMinutes = minArgIdx >= 0 ? Number(args[minArgIdx + 1]) : 15

function latestAppLogPath(): string {
  const dir = join(homedir(), 'Library/Application Support/sparkle/logs')
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('app-') && f.endsWith('.log'))
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return join(dir, files[0]?.f ?? 'app.log')
}

const logPath = logArgIdx >= 0 ? args[logArgIdx + 1] : latestAppLogPath()

if (!existsSync(logPath)) {
  console.error(`FAIL: log not found: ${logPath}`)
  process.exit(1)
}

const text = readFileSync(logPath, 'utf8')
const lines = text.trim().split('\n')
const cutoffMs = Date.now() - watchMinutes * 60_000

let maxStallSeen = 0
let maxCursorConnSeen = 0
let byteDeathStreakStart: number | undefined
let sawR2Executed = false
let sawQuiesceBypass = false
const failures: string[] = []

const GHOST_UDP_MARKERS = [
  'ghost_udp',
  'byte_death_ghost_udp',
  'ghost_udp_parent_birth_reset',
]

interface ByteDeathRecoveryWindow {
  plannedAt?: string
  sawExecutedMutation: boolean
  sawProbeOnlyFailed: boolean
}

let byteDeathRecoveryWindow: ByteDeathRecoveryWindow | undefined

function closeByteDeathRecoveryWindow(ts: string): void {
  if (byteDeathRecoveryWindow == null) {
    return
  }
  if (
    byteDeathRecoveryWindow.plannedAt != null &&
    !byteDeathRecoveryWindow.sawExecutedMutation &&
    !byteDeathRecoveryWindow.sawProbeOnlyFailed
  ) {
    failures.push(
      `${byteDeathRecoveryWindow.plannedAt}: Hy2ParentByteDeathRecovery planned without executed mutation (closed_count>0 or close_udp_outbound executed)`,
    )
  }
  byteDeathRecoveryWindow = undefined
}

for (const line of lines) {
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  if (!tsMatch) continue
  const ts = tsMatch[1]
  const tsMs = Date.parse(ts)
  if (tsMs < cutoffMs) continue

  if (GHOST_UDP_MARKERS.some((marker) => line.includes(marker))) {
    failures.push(`${ts}: forbidden ghost_udp recovery path detected (C-8 regression)`)
  }

  const connMatch = line.match(/cursor_conn=(\d+)/)
  if (connMatch) {
    maxCursorConnSeen = Math.max(maxCursorConnSeen, Number(connMatch[1]))
  }

  const stallMatch = line.match(/max_byte_stall_ms=(\d+)/)
  if (stallMatch) {
    const stall = Number(stallMatch[1])
    maxStallSeen = Math.max(maxStallSeen, stall)
    if (stall >= 90_000) {
      byteDeathStreakStart ??= tsMs
    } else if (byteDeathStreakStart != null && stall < 45_000) {
      byteDeathStreakStart = undefined
    }
  }

  if (line.includes('[Hy2ParentByteDeathRecovery]:')) {
    if (line.includes('outcome=planned')) {
      closeByteDeathRecoveryWindow(ts)
      byteDeathRecoveryWindow = {
        plannedAt: ts,
        sawExecutedMutation: false,
        sawProbeOnlyFailed: false,
      }
    }
    if (
      line.includes('outcome=executed') &&
      (line.includes('action=close_udp_outbound') ||
        (line.includes('action=close_leaf_connections') &&
          /closed_count=([1-9]\d*)/.test(line)))
    ) {
      if (byteDeathRecoveryWindow != null) {
        byteDeathRecoveryWindow.sawExecutedMutation = true
      }
      sawR2Executed = true
    }
  }

  if (line.includes('marathon_global_byte_death_bypass_active_inner')) {
    sawQuiesceBypass = true
  }
  if (
    line.includes('[Hy2ParentRotation]: outcome=executed') ||
    (line.includes('[StallEscalationLadder]') &&
      line.includes('action=parent_udp_refresh') &&
      line.includes('outcome=executed')) ||
    (line.includes('[CarrierQuiesceRefresh]') &&
      line.includes('outcome=executed') &&
      line.includes('carrier_quiesce_parent_udp_refresh')) ||
    (line.includes('[Hy2ParentSidecar]') &&
      line.includes('action=close_udp_outbound') &&
      line.includes('outcome=executed') &&
      line.includes('phase=execute'))
  ) {
    sawR2Executed = true
  }
  if (
    byteDeathStreakStart != null &&
    tsMs - byteDeathStreakStart > 180_000 &&
    line.includes('parent_udp_refresh') &&
    line.includes('active_inner_critical_flows')
  ) {
    failures.push(`${ts}: R2 still blocked by active_inner after 3min byte-death`)
  }

  if (
    line.includes('[Hy2ParentSidecar]') &&
    line.includes('byte_death_probe_only_without_udp_close') &&
    line.includes('outcome=failed')
  ) {
    if (byteDeathRecoveryWindow != null) {
      byteDeathRecoveryWindow.sawProbeOnlyFailed = true
    }
  } else if (
    line.includes('[Hy2ParentSidecar]') &&
    line.includes('byte_death_probe_only_without_udp_close') &&
    line.includes('outcome=executed')
  ) {
    failures.push(`${ts}: probe-only sidecar marked executed without prior mutation (C-8.10 regression)`)
  }

  if (
    line.includes('byte_death_probe_only_without_udp_close') &&
    line.includes('outcome=executed') &&
    !line.includes('outcome=failed')
  ) {
    const priorMutation =
      byteDeathRecoveryWindow?.sawExecutedMutation === true || sawR2Executed
    if (!priorMutation) {
      failures.push(`${ts}: byte_death_probe_only_without_udp_close succeeded without prior mutation`)
    }
  }
}

closeByteDeathRecoveryWindow('window_end')

if (maxCursorConnSeen >= 150 && maxStallSeen >= 90_000 && !sawR2Executed) {
  failures.push(
    `high-conn byte-death (cursor_conn=${maxCursorConnSeen} max_stall=${maxStallSeen}) without UDP close recovery`,
  )
}

if (maxStallSeen >= 144_000 && !sawR2Executed && !sawQuiesceBypass) {
  failures.push(
    `max_byte_stall_ms peaked at ${maxStallSeen} with no quiesce bypass or R2 executed in last ${watchMinutes}m`,
  )
}

if (failures.length > 0) {
  console.error('BYTE_DEATH_RECOVERY_GATE: FAIL')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(
  `BYTE_DEATH_RECOVERY_GATE: PASS (window=${watchMinutes}m max_stall=${maxStallSeen} max_conn=${maxCursorConnSeen} r2=${sawR2Executed} quiesce=${sawQuiesceBypass})`,
)
