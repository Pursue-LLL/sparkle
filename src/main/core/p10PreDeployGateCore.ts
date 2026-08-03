// [INPUT] P10 gate cores (code + fixture layers)
// [OUTPUT] runP10PreDeployGate
// [POS] SSOT §M.0.15.13 — single pre-deploy gate summary; nextGateAllowed only when code layer green.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runDialCapabilityInventoryAudit } from './dialCapabilityInventoryCore'
import { runP10ActiveUnknownMutationNegativeGate } from './p10ActiveUnknownMutationNegativeGateCore'
import {
  evaluateP10BaselineManifestFixture,
  evaluateP10WorkbenchStockPatchedDiff,
  evaluateP10_660d7a6fEvidenceGap,
} from './p10BaselineFixturesCore'
import { runP10PhysicalKpiGateForBaselineFixture } from './p10PhysicalKpiGateCore'
import { runP10ReplayGate } from './p10ReplayGateCore'
import { runP10StockParityGate } from './p10StockParityGateCore'
import { runP10TunLatencyGate } from './p10TunLatencyGateCore'
import type { P10MeasurementArtifact } from './p10MeasurementArtifactCore'
import type { P10TunLatencyFixture } from './p10TunLatencyGateCore'

export interface P10PreDeployGateCase {
  name: string
  ok: boolean
  blocked?: boolean
  detail: string
}

export interface P10PreDeployGateResult {
  ok: boolean
  nextGateAllowed: boolean
  codeLayerOk: boolean
  artifactLayerBlocked: boolean
  cases: P10PreDeployGateCase[]
}

export function loadLatestTunLatencyArtifact(): P10MeasurementArtifact<P10TunLatencyFixture> | undefined {
  const dir = join(homedir(), '.sparkle', 'p10-artifacts')
  if (!existsSync(dir)) {
    return undefined
  }
  const files = readdirSync(dir)
    .filter((name) => name.startsWith('tun-latency-') && name.endsWith('.json'))
    .sort()
  const latest = files.at(-1)
  if (!latest) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(join(dir, latest), 'utf8')) as P10MeasurementArtifact<P10TunLatencyFixture>
  } catch {
    return undefined
  }
}

export function loadLatestStockParityArtifact():
  | P10MeasurementArtifact<import('./p10StockParityGateCore').P10StockParityFixture[]>
  | undefined {
  const dir = join(homedir(), '.sparkle', 'p10-artifacts')
  if (!existsSync(dir)) {
    return undefined
  }
  const files = readdirSync(dir)
    .filter((name) => name.startsWith('stock-parity-') && name.endsWith('.json'))
    .sort()
  const latest = files.at(-1)
  if (!latest) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(join(dir, latest), 'utf8')) as P10MeasurementArtifact<
      import('./p10StockParityGateCore').P10StockParityFixture[]
    >
  } catch {
    return undefined
  }
}

export function runP10PreDeployGate(srcMainRoot: string): P10PreDeployGateResult {
  const cases: P10PreDeployGateCase[] = []

  const replay = runP10ReplayGate()
  cases.push({
    name: 'p10_replay_historical',
    ok: replay.ok,
    detail: replay.verdicts.filter((v) => !v.ok).map((v) => v.detail).join('; ') || 'ok',
  })

  const manifest = evaluateP10BaselineManifestFixture()
  cases.push({ name: 'p10_0_baseline_manifest', ok: manifest.ok, detail: manifest.detail })

  const workbenchDiff = evaluateP10WorkbenchStockPatchedDiff()
  cases.push({
    name: 'p10_0_workbench_stock_patched_diff',
    ok: workbenchDiff.ok,
    detail: workbenchDiff.detail,
  })

  const evidenceGap = evaluateP10_660d7a6fEvidenceGap()
  cases.push({ name: 'p10_0_660d7a6f_evidence_gap', ok: evidenceGap.ok, detail: evidenceGap.detail })

  const negative = runP10ActiveUnknownMutationNegativeGate()
  cases.push({
    name: 'p10_2_active_unknown_negative',
    ok: negative.ok,
    detail: negative.cases.filter((c) => !c.ok).map((c) => c.caller).join(', ') || 'ok',
  })

  const inventory = runDialCapabilityInventoryAudit(srcMainRoot)
  cases.push({
    name: 'p10_2_dial_capability_inventory',
    ok: inventory.ok,
    detail:
      inventory.violations.map((v) => `${v.module}:${v.missingPattern}`).join(', ') ||
      inventory.unlistedModules.join(', ') ||
      'ok',
  })

  const physicalKpi = runP10PhysicalKpiGateForBaselineFixture()
  cases.push({
    name: 'p10_5_physical_kpi_baseline',
    ok: !physicalKpi.ok,
    detail: `expect invalid baseline: ${physicalKpi.detail}`,
  })

  const stockArtifact = loadLatestStockParityArtifact()
  const stock = runP10StockParityGate(stockArtifact ? { artifact: stockArtifact } : {})
  cases.push({
    name: 'p10_6_stock_parity_artifact',
    ok: stock.ok,
    blocked: !stockArtifact,
    detail: stock.cases.map((item) => `${item.metric}:${item.detail}`).join('; ') || 'awaiting artifact',
  })

  const tunArtifact = loadLatestTunLatencyArtifact()
  const tun = runP10TunLatencyGate(tunArtifact ? { artifact: tunArtifact } : {})
  cases.push({
    name: 'p10_6_tun_tax_artifact',
    ok: tun.ok,
    blocked: !tunArtifact,
    detail: tun.detail,
  })

  const codeLayerOk = cases
    .filter((item) => !item.name.startsWith('p10_6'))
    .every((item) => item.ok)
  const artifactCases = cases.filter((item) => item.name.startsWith('p10_6'))
  const artifactLayerOk = artifactCases.every((item) => item.ok)
  const artifactLayerBlocked = !artifactLayerOk
  const nextGateAllowed = codeLayerOk && artifactLayerOk
  return {
    ok: codeLayerOk && artifactLayerOk,
    nextGateAllowed,
    codeLayerOk,
    artifactLayerBlocked,
    cases,
  }
}

export function defaultP10PreDeploySrcMainRoot(sparkleRoot: string): string {
  return join(sparkleRoot, 'src/main')
}
