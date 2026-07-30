/** Post-install gates — count failures only after install line offset (BUG-014 / R-27). */

export const BUG014_RESCUE_RESOURCE_NOT_FOUND_RE =
  /outcome=failed.*Resource not found|connect_stream_keepalive_failed.*Resource not found/

export const POST_CORE_BOOTSTRAP_FAILED_RE = /\[PostCoreBootstrap\]:.*failed/

export const API2_PROBE_PLANE_ON_RE = /\[Api2ProbePlane\]:.*ON/

function linesSinceExclusive(logText: string, sinceLineExclusive: number): string[] {
  if (sinceLineExclusive < 0) {
    return []
  }
  return logText.split('\n').slice(sinceLineExclusive)
}

export function countBug014RescueFailuresSinceLine(
  logText: string,
  sinceLineExclusive: number,
): number {
  return linesSinceExclusive(logText, sinceLineExclusive).filter((line) =>
    BUG014_RESCUE_RESOURCE_NOT_FOUND_RE.test(line),
  ).length
}

export function countPostCoreBootstrapFailuresSinceLine(
  logText: string,
  sinceLineExclusive: number,
): number {
  return linesSinceExclusive(logText, sinceLineExclusive).filter((line) =>
    POST_CORE_BOOTSTRAP_FAILED_RE.test(line),
  ).length
}

export function hasApi2ProbePlaneOnSinceLine(
  logText: string,
  sinceLineExclusive: number,
): boolean {
  return linesSinceExclusive(logText, sinceLineExclusive).some((line) =>
    API2_PROBE_PLANE_ON_RE.test(line),
  )
}
