/** Upgrade Safe Window SSOT — idle window, remedial G9, break-glass policy (1.30.5). */

export const UPGRADE_IDLE_WAIT_DEFAULT_SEC = 30 * 60

export const UPGRADE_BREAK_GLASS_ENV = 'SPARKLE_UPGRADE_BREAK_GLASS'

/** @deprecated Prefer SPARKLE_UPGRADE_BREAK_GLASS — kept for one release compat. */
export const LEGACY_P23_OVERRIDE_ENV = 'SPARKLE_OVERRIDE_P23_MARATHON_INSTALL'

export const REMEDIAL_G9_INCIDENT_REGISTRY_RELATIVE = '.sparkle/upgrade-incident-registry.json'

export const REMEDIAL_G9_CONTROL_PLANE_INCIDENT = 'BUG-2026-08-05-001'

export const REMEDIAL_G9_MIN_INSTALLED_VERSION = '1.30.3'

export const POST_INSTALL_RECOVERY_MAX_ROUNDS = 2

export const POST_INSTALL_RECOVERY_WAIT_SEC = 60

export interface UpgradeSafeWindowSnapshot {
  cursorConnectionCount: number
  quiesceActive: boolean
  blockColdRestart: boolean
  recentActiveLifecycleStreamCount: number
  observationAvailable: boolean
}

export interface UpgradeIncidentRegistry {
  active: string[]
}

export function parseUpgradeIncidentRegistry(raw: unknown): UpgradeIncidentRegistry {
  if (typeof raw !== 'object' || raw === null) {
    return { active: [] }
  }
  const record = raw as Record<string, unknown>
  const active = Array.isArray(record.active)
    ? record.active.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  return { active }
}

export function isUpgradeBreakGlassEnabled(
  breakGlassEnv: string | undefined = process.env[UPGRADE_BREAK_GLASS_ENV],
  legacyP23Env: string | undefined = process.env[LEGACY_P23_OVERRIDE_ENV],
): boolean {
  return breakGlassEnv === '1' || legacyP23Env === '1'
}

export function isUpgradeSafeWindowIdle(snapshot: UpgradeSafeWindowSnapshot): boolean {
  if (snapshot.cursorConnectionCount > 0) {
    return false
  }
  if (snapshot.quiesceActive || snapshot.blockColdRestart) {
    return false
  }
  if (snapshot.recentActiveLifecycleStreamCount > 0) {
    return false
  }
  if (!snapshot.observationAvailable && snapshot.cursorConnectionCount < 0) {
    return false
  }
  return true
}

export function formatUpgradeSafeWindowIdleReason(snapshot: UpgradeSafeWindowSnapshot): string {
  if (snapshot.cursorConnectionCount > 0) {
    return `cursor_conn_active:${snapshot.cursorConnectionCount}`
  }
  if (snapshot.quiesceActive) {
    return 'marathon_quiesce_active'
  }
  if (snapshot.blockColdRestart) {
    return 'marathon_block_cold_restart'
  }
  if (snapshot.recentActiveLifecycleStreamCount > 0) {
    return `recent_active_lifecycle:${snapshot.recentActiveLifecycleStreamCount}`
  }
  if (!snapshot.observationAvailable && snapshot.cursorConnectionCount < 0) {
    return 'cursor_conn_observation_unavailable'
  }
  return 'idle'
}

function parseSemverTuple(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return null
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareSemver(left: string, right: string): number | null {
  const leftTuple = parseSemverTuple(left)
  const rightTuple = parseSemverTuple(right)
  if (!leftTuple || !rightTuple) {
    return null
  }
  for (let index = 0; index < 3; index += 1) {
    if (leftTuple[index] !== rightTuple[index]) {
      return leftTuple[index] > rightTuple[index] ? 1 : -1
    }
  }
  return 0
}

export function isRemedialG9IncidentActive(
  registry: UpgradeIncidentRegistry,
  incidentId: string = REMEDIAL_G9_CONTROL_PLANE_INCIDENT,
): boolean {
  return registry.active.includes(incidentId)
}

export interface RemedialG9UpgradeInput {
  gateBlocked: boolean
  gateReason: string
  installedVersion: string | null
  targetVersion: string
  registry: UpgradeIncidentRegistry
}

export interface RemedialG9UpgradeResult {
  allowRemedial: boolean
  auditReason: string
}

export function evaluateRemedialG9Upgrade(input: RemedialG9UpgradeInput): RemedialG9UpgradeResult {
  if (!input.gateBlocked) {
    return { allowRemedial: false, auditReason: 'gate_not_blocked' }
  }
  if (!isRemedialG9IncidentActive(input.registry)) {
    return { allowRemedial: false, auditReason: 'incident_not_active_in_registry' }
  }
  if (!input.installedVersion) {
    return {
      allowRemedial: false,
      auditReason: 'missing_installed_version_for_remedial_g9',
    }
  }
  const installedVsMin = compareSemver(input.installedVersion, REMEDIAL_G9_MIN_INSTALLED_VERSION)
  const installedVsTarget = compareSemver(input.installedVersion, input.targetVersion)
  if (installedVsMin == null || installedVsTarget == null) {
    return { allowRemedial: false, auditReason: 'invalid_semver_for_remedial_g9' }
  }
  if (installedVsTarget >= 0) {
    return { allowRemedial: false, auditReason: 'installed_version_not_below_target' }
  }
  return {
    allowRemedial: true,
    auditReason:
      `remedial_g9_reason=control_plane_hotfix incident=${REMEDIAL_G9_CONTROL_PLANE_INCIDENT}` +
      ` installed=${input.installedVersion} target=${input.targetVersion} gate=${input.gateReason}`,
  }
}

export function shouldRunPostInstallRecoveryRound(input: {
  mihomoApiReady: boolean
  api2ProbePlaneOn: boolean
  postCoreBootstrapFailed: boolean
  roundIndex: number
  maxRounds: number
}): boolean {
  if (input.roundIndex >= input.maxRounds) {
    return false
  }
  if (input.mihomoApiReady && input.api2ProbePlaneOn && !input.postCoreBootstrapFailed) {
    return false
  }
  return true
}
