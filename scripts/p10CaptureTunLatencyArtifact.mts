#!/usr/bin/env tsx
/** P10-6 read-only TUN vs mixed-port latency capture — writes measurement artifact (no Cursor mutation). */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { P10MeasurementArtifact } from '../src/main/core/p10MeasurementArtifactCore'
import type { P10TunLatencyFixture } from '../src/main/core/p10TunLatencyGateCore'

function percentileMs(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return Math.round(sorted[index] ?? 0)
}

function computePerSamplePairedTaxPercentiles(input: {
  tunMs: readonly number[]
  mixedMs: readonly number[]
}): { p50Ms: number; p95Ms: number; samples: number } {
  const samples = Math.min(input.tunMs.length, input.mixedMs.length)
  const taxMs: number[] = []
  for (let index = 0; index < samples; index += 1) {
    const tun = input.tunMs[index]
    const mixed = input.mixedMs[index]
    if (tun == null || mixed == null) {
      continue
    }
    taxMs.push(tun - mixed)
  }
  return {
    samples: taxMs.length,
    p50Ms: percentileMs(taxMs, 50),
    p95Ms: percentileMs(taxMs, 95),
  }
}

const execFileAsync = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const MIXED_PORT = Number(process.env.P10_MIXED_PORT ?? '7890')
const TARGET_URL = process.env.P10_LATENCY_TARGET ?? 'http://www.gstatic.com/generate_204'
const SAMPLE_COUNT = Number(process.env.P10_LATENCY_SAMPLES ?? '100')
const ARTIFACT_DIR = join(homedir(), '.sparkle', 'p10-artifacts')

async function curlConnectMs(viaMixed: boolean): Promise<number | undefined> {
  const args = [
    '-s',
    '-o',
    '/dev/null',
    '-w',
    '%{time_connect}',
    '--max-time',
    '2',
    TARGET_URL,
  ]
  if (viaMixed) {
    args.unshift('-x', `http://127.0.0.1:${MIXED_PORT}`)
  }
  try {
    const { stdout } = await execFileAsync('curl', args, { timeout: 3000 })
    const ms = Number.parseFloat(String(stdout).trim()) * 1000
    return Number.isFinite(ms) ? ms : undefined
  } catch {
    return undefined
  }
}

async function samplePairedConnectMs(): Promise<{ tunMs?: number; mixedMs?: number }> {
  const mixedMs = await curlConnectMs(true)
  const tunMs = await curlConnectMs(false)
  return { tunMs, mixedMs }
}

async function main(): Promise<void> {
  const tun: number[] = []
  const mixed: number[] = []
  while (tun.length < SAMPLE_COUNT) {
    const pair = await samplePairedConnectMs()
    if (pair.mixedMs != null && pair.tunMs != null) {
      mixed.push(pair.mixedMs)
      tun.push(pair.tunMs)
    }
  }
  const pairedTax = computePerSamplePairedTaxPercentiles({ tunMs: tun, mixedMs: mixed })
  const payload: P10TunLatencyFixture = {
    samples: SAMPLE_COUNT,
    tun: { p50Ms: percentileMs(tun, 50), p95Ms: percentileMs(tun, 95) },
    mixedPort: { p50Ms: percentileMs(mixed, 50), p95Ms: percentileMs(mixed, 95) },
    pairedTax,
    maxTunP50TaxMs: 50,
    maxTunP95TaxMs: 100,
  }
  const capturedAtIso = new Date().toISOString()
  const artifact: P10MeasurementArtifact<P10TunLatencyFixture> & {
    rawTunMs?: number[]
    rawMixedMs?: number[]
  } = {
    meta: {
      schemaVersion: 'p10-measurement-artifact.v1',
      capturedAtIso,
      source: 'p10CaptureTunLatencyArtifact.mts',
      sha256: 'pending',
      endpoint: TARGET_URL,
      node: process.env.P10_ACTIVE_LEAF ?? 'JP-VPS-HY2',
    },
    payload,
    rawTunMs: tun,
    rawMixedMs: mixed,
  }
  const serialized = JSON.stringify(artifact, null, 2)
  const sha256Final = createHash('sha256').update(serialized).digest('hex')
  artifact.meta.sha256 = sha256Final
  const serializedFinal = JSON.stringify(artifact, null, 2)
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const artifactPath = join(ARTIFACT_DIR, `tun-latency-${capturedAtIso.replace(/[:.]/g, '-')}.json`)
  writeFileSync(artifactPath, `${serializedFinal}\n`, 'utf8')
  const tunMod = await import(pathToFileURL(join(ROOT, 'src/main/core/p10TunLatencyGateCore.ts')).href)
  const gate = tunMod.runP10TunLatencyGate({ artifact })
  console.log(`[P10CaptureTunLatency]: artifact ${artifactPath}`)
  console.log(`[P10CaptureTunLatency]: sha256=${sha256Final}`)
  console.log(
    `[P10CaptureTunLatency]: tun p50=${payload.tun.p50Ms} mixed p50=${payload.mixedPort.p50Ms} tax p50=${gate.p50TaxMs}`,
  )
  console.log(`[P10CaptureTunLatency]: gate ${gate.ok ? 'PASS' : 'FAIL'} — ${gate.detail}`)
  process.exit(gate.ok ? 0 : 1)
}

void main()
