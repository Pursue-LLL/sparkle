// [INPUT] collectiveDeathBugReport · showNotification
// [OUTPUT] notifyCollectiveDeathAlert
// [POS] GUI alert for mass disconnect / byte-death with copy-bug-report action.

import { buildCollectiveDeathBugReport, type BuildCollectiveDeathBugReportInput } from './collectiveDeathBugReport'

const COLLECTIVE_DEATH_NOTIFY_COOLDOWN_MS = 5 * 60_000
let lastNotifiedAtMs = 0

export function resetCollectiveDeathAlertForTests(): void {
  lastNotifiedAtMs = 0
}

export async function notifyCollectiveDeathAlert(
  input: BuildCollectiveDeathBugReportInput & {
    title: string
    body: string
  },
): Promise<void> {
  const nowMs = input.tsMs ?? Date.now()
  if (nowMs - lastNotifiedAtMs < COLLECTIVE_DEATH_NOTIFY_COOLDOWN_MS) {
    return
  }
  lastNotifiedAtMs = nowMs
  // Pure-pipe: build background report for diagnostics only, permanently suppress intrusive GUI popup
  await buildCollectiveDeathBugReport(input)
}
