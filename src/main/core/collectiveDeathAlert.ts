// [INPUT] collectiveDeathBugReport · showNotification
// [OUTPUT] notifyCollectiveDeathAlert
// [POS] GUI alert for mass disconnect / byte-death with copy-bug-report action.

import { buildCollectiveDeathBugReport, type BuildCollectiveDeathBugReportInput } from './collectiveDeathBugReport'
import { dismissNotification, showNotification } from '../utils/notification'

const COLLECTIVE_DEATH_NOTIFY_COOLDOWN_MS = 5 * 60_000
let lastNotifiedAtMs = 0

export function resetCollectiveDeathAlertForTests(): void {
  lastNotifiedAtMs = 0
}

export function dismissCollectiveDeathAlert(): void {
  dismissNotification('sparkle-collective-death')
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
  await buildCollectiveDeathBugReport(input)
  await showNotification({
    id: 'sparkle-collective-death',
    title: input.title,
    body: input.body,
    variant: 'danger',
    persistent: true,
    forceToast: true,
    actionKind: 'copy-bug-report',
  })
}
