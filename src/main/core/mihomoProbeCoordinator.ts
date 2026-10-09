/** Global cap on concurrent mihomo proxy delay API calls — avoids TUN/mihomo storms. */

export const MIHOMO_DELAY_PROBE_MAX_CONCURRENT = 2
const SLOT_WAIT_MS = 250
const SLOT_WAIT_MAX_MS = 30_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

let activeDelayProbes = 0

export function getActiveMihomoDelayProbes(): number {
  return activeDelayProbes
}

function isSlotPoolFull(): boolean {
  return activeDelayProbes >= MIHOMO_DELAY_PROBE_MAX_CONCURRENT
}

export async function withMihomoDelayProbeSlot<T>(fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  while (isSlotPoolFull()) {
    if (Date.now() - startedAt >= SLOT_WAIT_MAX_MS) {
      throw new Error('mihomo delay probe slot wait timeout')
    }
    await sleep(SLOT_WAIT_MS)
  }
  activeDelayProbes += 1
  try {
    return await fn()
  } finally {
    activeDelayProbes -= 1
  }
}

export function resetMihomoDelayProbeCoordinatorForTests(): void {
  activeDelayProbes = 0
}
