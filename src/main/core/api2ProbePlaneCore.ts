/** Global mutex for api2 active + VPS probe HTTP — prevents concurrent api2 hits. */

let planeBusy = false

export function isApi2ProbePlaneActive(): boolean {
  return planeBusy
}

export async function withApi2ProbePlaneLock<T>(
  _label: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  if (planeBusy) {
    return undefined
  }
  planeBusy = true
  try {
    return await fn()
  } finally {
    planeBusy = false
  }
}

export function tryAcquireApi2ProbePlaneLock(): boolean {
  if (planeBusy) {
    return false
  }
  planeBusy = true
  return true
}

export function releaseApi2ProbePlaneLock(): void {
  planeBusy = false
}
