#!/usr/bin/env tsx
/** P10-6 read-only TUN vs mixed-port latency capture — writes measurement artifact (no Cursor mutation). */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import type { P10MeasurementArtifact } from '../src/main/core/p10MeasurementArtifactCore.ts'
import type { P10TunLatencyFixture } from '../src/main/core/p10TunLatencyGateCore.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const MIXED_PORT = Number(process.env.P10_MIXED_PORT ?? '7890')
const TARGET_URL = process.env.P10_LATENCY_TARGET ?? 'https://api2.cursor.sh'
const SAMPLE_COUNT = Number(process.env.P10_LATENCY_SAMPLES ?? '100')
const BATCH_SIZE = Number(process.env.P10_LATENCY_BATCH ?? '10')
const ARTIFACT_DIR = join(homedir(), '.sparkle', 'p10-artifacts')

function curlConnectMs(viaMixed: boolean): number | undefined {
  const args = [
    '-s',
    '-o',
    '/dev/null',
    '-w',
    '%{time_connect}',
    '--max-time',
    '3',
    TARGET_URL,
  ]
  if (viaMixed) {
    args.unshift('-x', `http://127.0.0.1:${MIXED_PORT}`)
  }
  const result = spawnSync('curl', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    return undefined
  }
  const ms = Number.parseFloat(String(result.stdout).trim()) * 1000
  return Number.isFinite(ms) ? ms : undefined
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return Math.round(sorted[index] ?? 0)
}

async function sampleBatch(viaMixed: boolean, count: number): Promise<number[]> {
  const rows = await Promise.all(
    Array.from({ length: count }, async () => {
      return curlConnectMs(viaMixed)
    }),
  )
  return rows.filter((value): value is number => value != null)
}

async function main(): Promise<void> {
  const tunSamples: number[] = []
  const mixedSamples: number[] = []
  while (tunSamples.length < SAMPLE_COUNT || mixedSamples.length < SAMPLE_COUNT) {
    const [mixedBatch, tunBatch] = await Promise.all([
      sampleBatch(true, BATCH_SIZE),
      sampleBatch(false, BATCH_SIZE),
    ])
    mixedSamples.push(...mixedBatch)
    tunSamples.push(...tunBatch)
    if (mixedSamples.length >= SAMPLE_COUNT && tunSamples.length >= SAMPLE_COUNT) {
      break
    }
  }
  if (tunSamples.length < 20 || mixedSamples.length < 20) {
    console.error(
      `[P10CaptureTunLatency]: FAIL — insufficient samples tun=${tunSamples.length} mixed=${mixedSamples.length}`,
    )
    process.exit(1)
  }
  const payload: P10TunLatencyFixture = {
    samples: Math.min(tunSamples.length, mixedSamples.length),
    tun: { p50Ms: percentile(tunSamples, 50), p95Ms: percentile(tunSamples, 95) },
    mixedPort: { p50Ms: percentile(mixedSamples, 50), p95Ms: percentile(mixedSamples, 95) },
    maxTunP50TaxMs: 50,
    maxTunP95TaxMs: 100,
  }
  const capturedAtIso = new Date().toISOString()
  const body = JSON.stringify({ meta: { capturedAtIso, target: TARGET_URL, mixedPort: MIXED_PORT }, payload }, null, 2)
  const sha256 = createHash('sha256').update(body).digest('hex')
  const artifact: P10MeasurementArtifact<P10TunLatencyFixture> = {
    meta: {
      schemaVersion: 'p10-measurement-artifact.v1',
      capturedAtIso,
      source: 'p10CaptureTunLatencyArtifact.mts',
      sha256,
      endpoint: TARGET_URL,
      node: process.env.P10_ACTIVE_LEAF ?? 'JP-VPS-HY2',
    },
    payload,
  }
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const artifactPath = join(ARTIFACT_DIR, `tun-latency-${capturedAtIso.replace(/[:.]/g, '-')}.json`)
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  const tunMod = await import(pathToFileURL(join(ROOT, 'src/main/core/p10TunLatencyGateCore.ts')).href)
  const gate = tunMod.runP10TunLatencyGate({ artifact })
  console.log(`[P10CaptureTunLatency]: artifact ${artifactPath}`)
  console.log(`[P10CaptureTunLatency]: sha256=${sha256}`)
  console.log(
    `[P10CaptureTunLatency]: tun p50=${payload.tun.p50Ms} mixed p50=${payload.mixedPort.p50Ms} tax p50=${gate.p50TaxMs}`,
  )
  console.log(`[P10CaptureTunLatency]: gate ${gate.ok ? 'PASS' : 'FAIL'} — ${gate.detail}`)
  process.exit(gate.ok ? 0 : 1)
}

void main()
