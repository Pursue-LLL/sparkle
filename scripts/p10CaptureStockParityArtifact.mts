#!/usr/bin/env tsx
/** P10-6 read-only stock-vs-telemetry parity artifact from api2-probe-ledger (no Cursor mutation). */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import type { P10MeasurementArtifact } from '../src/main/core/p10MeasurementArtifactCore'
import type { P10StockParityFixture } from '../src/main/core/p10StockParityGateCore'

function percentileMs(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return Math.round(sorted[index] ?? 0)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACT_DIR = join(homedir(), '.sparkle', 'p10-artifacts')
const PROBE_LEDGER =
  process.env.P10_PROBE_LEDGER ?? join(homedir(), '.sparkle', 'api2-probe-ledger.jsonl')
const MIN_SAMPLES = Number(process.env.P10_STOCK_PARITY_SAMPLES ?? '100')

interface ProbeRow {
  method?: string
  ok?: boolean
  latency_ms?: number
  ts?: string
}

function percentileSnapshot(values: readonly number[]): {
  samples: number
  p50: number
  p95: number
  p99: number
} {
  return {
    samples: values.length,
    p50: percentileMs(values, 50),
    p95: percentileMs(values, 95),
    p99: percentileMs(values, 99),
  }
}

function loadProbeLatencies(method: string): number[] {
  if (!existsSync(PROBE_LEDGER)) {
    return []
  }
  const rows: number[] = []
  for (const line of readFileSync(PROBE_LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue
    }
    try {
      const row = JSON.parse(line) as ProbeRow
      if (row.method !== method || row.ok !== true) {
        continue
      }
      const latency = row.latency_ms
      if (typeof latency === 'number' && latency >= 0) {
        rows.push(latency)
      }
    } catch {
      continue
    }
  }
  return rows.slice(-MIN_SAMPLES)
}

function loadProbeBinarySeries(method: string): number[] {
  if (!existsSync(PROBE_LEDGER)) {
    return []
  }
  const rows: number[] = []
  for (const line of readFileSync(PROBE_LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue
    }
    try {
      const row = JSON.parse(line) as ProbeRow
      if (row.method !== method) {
        continue
      }
      rows.push(row.ok === true ? 0 : 1)
    } catch {
      continue
    }
  }
  return rows.slice(-MIN_SAMPLES)
}

async function main(): Promise<void> {
  const stockHttpStart = loadProbeLatencies('ssh_curl')
  const telemetryHttpStart = loadProbeLatencies('marathon_connect_path_pulse')
  const stockFirstToken = loadProbeLatencies('session_nudge')
  const telemetryFirstToken = loadProbeLatencies('marathon_connect_path_pulse')
  const disconnect = {
    stock: loadProbeBinarySeries('ssh_curl'),
    telemetry: loadProbeBinarySeries('marathon_connect_path_pulse'),
  }

  const fixtures: P10StockParityFixture[] = [
    {
      metric: 'http_start_ms',
      stock: percentileSnapshot(stockHttpStart),
      telemetry: percentileSnapshot(telemetryHttpStart),
      maxRegressionRatio: 0.1,
    },
    {
      metric: 'first_token_ms',
      stock: percentileSnapshot(stockFirstToken),
      telemetry: percentileSnapshot(telemetryFirstToken),
      maxRegressionRatio: 0.08,
    },
    {
      metric: 'disconnect_rate_per_100',
      stock: percentileSnapshot(disconnect.stock),
      telemetry: percentileSnapshot(disconnect.telemetry),
      maxRegressionRatio: 0.15,
    },
  ]

  const capturedAtIso = new Date().toISOString()
  const artifact: P10MeasurementArtifact<readonly P10StockParityFixture[]> = {
    meta: {
      schemaVersion: 'p10-measurement-artifact.v1',
      capturedAtIso,
      source: 'p10CaptureStockParityArtifact.mts',
      sha256: 'pending',
      endpoint: PROBE_LEDGER,
      node: process.env.P10_ACTIVE_LEAF ?? 'JP-VPS-HY2',
    },
    payload: fixtures,
  }
  const serialized = JSON.stringify(artifact, null, 2)
  const sha256Final = createHash('sha256').update(serialized).digest('hex')
  artifact.meta.sha256 = sha256Final
  const serializedFinal = JSON.stringify(artifact, null, 2)
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const artifactPath = join(ARTIFACT_DIR, `stock-parity-${capturedAtIso.replace(/[:.]/g, '-')}.json`)
  writeFileSync(artifactPath, `${serializedFinal}\n`, 'utf8')

  const stockMod = await import(pathToFileURL(join(ROOT, 'src/main/core/p10StockParityGateCore.ts')).href)
  const gate = stockMod.runP10StockParityGate({ artifact })
  console.log(`[P10CaptureStockParity]: artifact ${artifactPath}`)
  console.log(`[P10CaptureStockParity]: sha256=${sha256Final}`)
  for (const item of gate.cases) {
    console.log(`[P10CaptureStockParity]: ${item.metric} ${item.ok ? 'PASS' : 'FAIL'} — ${item.detail}`)
  }
  console.log(`[P10CaptureStockParity]: gate ${gate.ok ? 'PASS' : 'FAIL'}`)
  process.exit(gate.ok ? 0 : 1)
}

void main()
