// [INPUT] P10 gate cores (code + fixture layers)
// [OUTPUT] runP10PreDeployGate
// [POS] SSOT §M.0.15.13 — single pre-deploy gate summary; nextGateAllowed only when code layer green.

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

  const stock = runP10StockParityGate()
  cases.push({
    name: 'p10_6_stock_parity_artifact',
    ok: false,
    blocked: true,
    detail: stock.cases[0]?.detail ?? 'awaiting artifact',
  })

  const tun = runP10TunLatencyGate()
  cases.push({
    name: 'p10_6_tun_tax_artifact',
    ok: false,
    blocked: true,
    detail: tun.detail,
  })

  const codeLayerOk = cases
    .filter((item) => !item.blocked)
    .every((item) => item.ok)
  const artifactLayerBlocked = cases.some((item) => item.blocked)
  const nextGateAllowed = codeLayerOk && !artifactLayerBlocked
  return {
    ok: codeLayerOk,
    nextGateAllowed,
    codeLayerOk,
    artifactLayerBlocked,
    cases,
  }
}

export function defaultP10PreDeploySrcMainRoot(sparkleRoot: string): string {
  return join(sparkleRoot, 'src/main')
}
