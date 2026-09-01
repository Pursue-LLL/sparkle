// [INPUT] none
// [OUTPUT] CoreReadyReason · POST_CORE_READY_FAKE_IP_FLUSH_RETRIES
// [POS] SSOT — core start/stop lifecycle reason + flush policy constants.

export type CoreReadyReason =
  | 'cold_start'
  | 'emergency'
  | 'manual'
  | 'service'
  | 'post_core_ready'

export const POST_CORE_READY_FAKE_IP_FLUSH_RETRIES = 3
export const POST_CORE_READY_FAKE_IP_FLUSH_RETRY_MS = 2_000

export function formatCoreLifecycleLogLine(input: {
  phase: 'post_ready'
  action: 'fake_ip_flush'
  outcome: 'executed' | 'failed'
  reason: CoreReadyReason
  attempt?: number
  err?: string
}): string {
  const parts = [
    `[CoreLifecycle]: phase=${input.phase}`,
    `action=${input.action}`,
    `outcome=${input.outcome}`,
    `reason=${input.reason}`,
  ]
  if (input.attempt != null) {
    parts.push(`attempt=${input.attempt}`)
  }
  if (input.err) {
    parts.push(`err=${input.err}`)
  }
  return `${parts.join(' ')}\n`
}
