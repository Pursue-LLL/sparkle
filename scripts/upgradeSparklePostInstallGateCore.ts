/** Post-install gates — evaluate app-log lines only after the install line offset (R-27). */

export const POST_CORE_BOOTSTRAP_FAILED_RE = /\[PostCoreBootstrap\]:.*failed/

export const POST_CORE_BOOTSTRAP_NOT_REACHABLE_RE =
  /\[PostCoreBootstrap\]: mihomo API not reachable/

export const MIHOMO_API_READY_RE = /\[PostCoreBootstrap\]: mihomo API ready/

export const MACOS26_HEADLESS_COMPLETE_RE = /\[MacOs26Headless\]: bootstrap complete/

function linesSinceExclusive(logText: string, sinceLineExclusive: number): string[] {
  if (sinceLineExclusive < 0) {
    return []
  }
  return logText.split('\n').slice(sinceLineExclusive)
}

export function countPostCoreBootstrapFailuresSinceLine(
  logText: string,
  sinceLineExclusive: number,
): number {
  return linesSinceExclusive(logText, sinceLineExclusive).filter((line) =>
    POST_CORE_BOOTSTRAP_FAILED_RE.test(line),
  ).length
}

export function hasMihomoApiReadySinceLine(
  logText: string,
  sinceLineExclusive: number,
): boolean {
  return linesSinceExclusive(logText, sinceLineExclusive).some((line) =>
    MIHOMO_API_READY_RE.test(line),
  )
}

export function countPostCoreBootstrapNotReachableSinceLine(
  logText: string,
  sinceLineExclusive: number,
): number {
  return linesSinceExclusive(logText, sinceLineExclusive).filter((line) =>
    POST_CORE_BOOTSTRAP_NOT_REACHABLE_RE.test(line),
  ).length
}

export function hasMacOs26HeadlessBootstrapCompleteSinceLine(
  logText: string,
  sinceLineExclusive: number,
): boolean {
  return linesSinceExclusive(logText, sinceLineExclusive).some((line) =>
    MACOS26_HEADLESS_COMPLETE_RE.test(line),
  )
}

export function isMacOsProductVersion26OrNewer(productVersion: string): boolean {
  const head = productVersion.split('.')[0] ?? '0'
  const major = parseInt(head, 10)
  return Number.isFinite(major) && major >= 26
}
