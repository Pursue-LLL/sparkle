/** BUG-014 post-install gate — count rescue Resource not found only after install line offset. */

export const BUG014_RESCUE_RESOURCE_NOT_FOUND_RE =
  /outcome=failed.*Resource not found|connect_stream_keepalive_failed.*Resource not found/

export function countBug014RescueFailuresSinceLine(
  logText: string,
  sinceLineExclusive: number,
): number {
  if (sinceLineExclusive < 0) {
    return 0
  }
  const lines = logText.split('\n')
  let count = 0
  for (let index = sinceLineExclusive; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (BUG014_RESCUE_RESOURCE_NOT_FOUND_RE.test(line)) {
      count += 1
    }
  }
  return count
}
