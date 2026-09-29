// [INPUT] mihomoApi · recoveryApi2Anchor mixed-port · cursor dedicated group
// [OUTPUT] collectProxyStackDeadlockEvidence
// [POS] Runtime probes for proxyStackDeadlockCore admission gate.

import { appendAppLog } from '../utils/log'
import { mihomoGroups, mihomoProxyDelay } from './mihomoApi'
import { API2_PROBE_TARGET } from './cursorTransportHealthCore'
import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { resolveCursorDedicatedActiveNode } from './cursorDedicatedNodeResolver'
import { resolveLeafFailoverTarget } from './recoveryLeafFailoverCore'
import {
  evaluateProxyStackDeadlockAdmission,
  formatProxyStackDeadlockLogLine,
  selectLeafProbeTargets,
  type LongflowEvidence,
  type ProxyStackDeadlockEvidence,
} from './proxyStackDeadlockCore'

const MIXED_PORT_PROXY = 'http://127.0.0.1:7890'
const LEAF_PROBE_TIMEOUT_MS = 5_000
const CONTROLLER_PROBE_MAX_MS = 4_000
const MAX_LEAF_SAMPLES = 4

let testEvidenceOverride: (() => Promise<ProxyStackDeadlockEvidence>) | null = null

export function setProxyStackDeadlockEvidenceOverrideForTests(
  override: typeof testEvidenceOverride,
): void {
  testEvidenceOverride = override
}

export function resetProxyStackDeadlockRuntimeForTests(): void {
  testEvidenceOverride = null
}

async function probeMixedPortApi2(): Promise<boolean> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  try {
    await execFileAsync('curl', [
      '-sf',
      '--max-time',
      '5',
      '-x',
      MIXED_PORT_PROXY,
      `${API2_PROBE_TARGET}/`,
    ])
    return true
  } catch {
    return false
  }
}

async function probeControllerReachable(): Promise<boolean> {
  const { waitForMihomoControllerReady } = await import('./postCoreBootstrap')
  return waitForMihomoControllerReady(CONTROLLER_PROBE_MAX_MS)
}

async function resolveLeafSamples(activeLeaf: string | undefined): Promise<string[]> {
  const samples = new Set<string>()
  const trimmedActive = activeLeaf?.trim()
  if (trimmedActive) {
    samples.add(trimmedActive)
  }
  try {
    const groups = await mihomoGroups()
    const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
    const members =
      cursorGroup?.all
        .map((proxy) => proxy?.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0) ?? []
    if (trimmedActive) {
      let failedLeaf = trimmedActive
      for (let attempt = 0; attempt < 3 && samples.size < MAX_LEAF_SAMPLES; attempt += 1) {
        const target = resolveLeafFailoverTarget({
          failedLeafId: failedLeaf,
          availableMembers: members,
        })
        if (!target || samples.has(target)) {
          break
        }
        samples.add(target)
        failedLeaf = target
      }
    }
    for (const member of members) {
      if (samples.size >= MAX_LEAF_SAMPLES) {
        break
      }
      samples.add(member)
    }
  } catch {
    // best-effort leaf sampling
  }
  return [...samples].slice(0, MAX_LEAF_SAMPLES)
}

async function probeLeafApi2(leaf: string): Promise<boolean> {
  try {
    const result = await mihomoProxyDelay(leaf, API2_PROBE_TARGET, {
      purpose: 'marathon_rescue',
      timeoutMs: LEAF_PROBE_TIMEOUT_MS,
    })
    return typeof result.delay === 'number' && result.delay > 0
  } catch {
    return false
  }
}

export async function collectProxyStackDeadlockEvidence(): Promise<ProxyStackDeadlockEvidence> {
  if (testEvidenceOverride) {
    return testEvidenceOverride()
  }
  const mixedPortApi2Ok = await probeMixedPortApi2()
  const controllerReachable = await probeControllerReachable()
  const activeLeaf = await resolveCursorDedicatedActiveNode()
  const leafNames = await resolveLeafSamples(activeLeaf ?? undefined)
  const probeTargets = selectLeafProbeTargets(controllerReachable, leafNames)
  const leafProbes = await Promise.all(
    probeTargets.map(async (leaf) => ({ leaf, ok: await probeLeafApi2(leaf) })),
  )
  return {
    mixedPortApi2Ok,
    controllerReachable,
    leafProbes,
  }
}

export async function confirmProxyStackDeadlockForCoreRestart(
  longflow: LongflowEvidence,
): Promise<{
  confirmed: boolean
  reason: string
  evidence: ProxyStackDeadlockEvidence
}> {
  const evidence = await collectProxyStackDeadlockEvidence()
  const verdict = evaluateProxyStackDeadlockAdmission(evidence, longflow)
  const leafProbeSummary =
    evidence.leafProbes.map((entry) => `${entry.leaf}:${entry.ok ? 'ok' : 'fail'}`).join(',') ||
    'none'
  await appendAppLog(
    formatProxyStackDeadlockLogLine({
      outcome: verdict.confirmed ? 'confirmed' : 'blocked',
      reason: verdict.reason,
      mixedPortApi2Ok: evidence.mixedPortApi2Ok,
      controllerReachable: evidence.controllerReachable,
      leafProbeSummary,
      longflowEvidence: longflow,
    }),
  )
  return { ...verdict, evidence }
}
