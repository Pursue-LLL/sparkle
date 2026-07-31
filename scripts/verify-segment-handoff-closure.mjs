#!/usr/bin/env node
/**
 * Post-apply closure verify for P22 segment handoff observe-only + quic-stall-ssot.
 * Usage: node scripts/verify-segment-handoff-closure.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const WB =
  process.env.CURSOR_WB ??
  '/Applications/Cursor-3.1.15.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js'
const PATCH = join(homedir(), '.cursor-500-guard/bin/cursor-agent-stability-patch.mjs')
const SSOT = join(homedir(), '.sparkle/quic-stall-ssot.json')

const errors = []

function expect(label, ok) {
  if (!ok) {
    errors.push(label)
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
}

if (!existsSync(WB)) {
  console.error(`ERROR: workbench missing: ${WB}`)
  process.exit(1)
}

const wb = readFileSync(WB, 'utf8')
const patch = existsSync(PATCH) ? readFileSync(PATCH, 'utf8') : ''

expect('workbench segment-handoff-observe-only marker', wb.includes('ifm-patch-315 segment-handoff-observe-only'))
expect('workbench activity-hook marker', wb.includes('ifm-patch-315 segment-handoff-activity-hook'))
expect('workbench detect_only phase in handoff', wb.includes('phase:"detect_only"'))
expect('workbench forbids execute marker', !wb.includes('ifm-patch-315 segment-handoff-execute'))
expect(
  'workbench forbids proactive resumeChat inject',
  !wb.includes('function _ifmC2ExecuteProactiveSegmentHandoff('),
)
expect('workbench reads quic-stall-ssot.json', wb.includes('quic-stall-ssot.json'))
expect('workbench ssot staleness gate', wb.includes('Date.now()-updatedAtMs>120000'))
expect(
  'workbench pending-tool deferred log',
  wb.includes('phase:"pending-tool"') || wb.includes("phase:'pending-tool'"),
)
const ssotReaderFn =
  wb.match(/function _ifm315ReadQuicStallSsot\(\)\{[\s\S]*?\}(?=function )/)?.[0] ?? ''
expect(
  'workbench handoff ssot reader uses atom only (no legacy jsonl stall_ms)',
  ssotReaderFn.includes('quic-stall-ssot.json') &&
    !ssotReaderFn.includes('network-stability-events.jsonl') &&
    !ssotReaderFn.includes('stall_ms'),
)

if (patch) {
  expect('patch script defines observe-only handoff', patch.includes('patch315SegmentHandoffObserveOnly'))
  expect('patch script defines observe bridge', patch.includes('build315HandoffObserveBridgeSource'))
  expect('patch script forbids execute in observe steps', !patch.includes('patch315SegmentHandoffExecute'))
}

if (existsSync(SSOT)) {
  try {
    const row = JSON.parse(readFileSync(SSOT, 'utf8'))
    expect('ssot file has updatedAtMs', typeof row.updatedAtMs === 'number' && row.updatedAtMs > 0)
    expect('ssot file fresh (<120s)', Date.now() - row.updatedAtMs <= 120_000)
  } catch {
    expect('ssot file parseable json', false)
  }
} else {
  console.log('WARN: ssot file absent (Sparkle may be stopped):', SSOT)
}

if (errors.length > 0) {
  console.error('\nClosure verify FAILED:', errors.join(', '))
  process.exit(1)
}

console.log('\nClosure verify OK')
