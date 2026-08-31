// [INPUT] mihomo -t profile validation · transient provider gaps
// [OUTPUT] checkProfileWithRetry
// [POS] Profile phase of Core Readiness Contract (no manager import).

import { appendAppLog } from '../utils/log'
import { generateProfile } from './factory'
import { checkProfile } from './profile-check'
import {
  CoreReadinessError,
  PROFILE_CHECK_MAX_ATTEMPTS,
  PROFILE_CHECK_RETRY_DELAY_MS,
  formatCoreReadinessPhaseLog,
  shouldRetryProfileCheck,
} from './coreReadinessGateCore'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function checkProfileWithRetry(
  maxAttempts: number = PROFILE_CHECK_MAX_ATTEMPTS,
): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await checkProfile()
      if (attempt > 1) {
        await appendAppLog(formatCoreReadinessPhaseLog('profile', 'check_ok', `attempt=${attempt}`))
      }
      return
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!shouldRetryProfileCheck(message) || attempt === maxAttempts) {
        throw new CoreReadinessError('PROFILE_CHECK_FAILED', 'profile', message)
      }
      await appendAppLog(
        formatCoreReadinessPhaseLog('profile', 'check_retry', `attempt=${attempt} reason=${message}`),
      )
      await generateProfile()
      await delay(PROFILE_CHECK_RETRY_DELAY_MS)
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new CoreReadinessError('PROFILE_CHECK_FAILED', 'profile', message)
}
