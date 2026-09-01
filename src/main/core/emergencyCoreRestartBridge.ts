// [INPUT] manager registers handler at init
// [OUTPUT] invokeEmergencyCoreRestart
// [POS] Break circular index.js require from emergencyCoreRecovery chunk.

export interface EmergencyCoreRestartInput {
  leafId: string
  evidenceReason: string
  requestedAtMs: number
  deadlineMs: number
}

type EmergencyCoreRestartHandler = (input: EmergencyCoreRestartInput) => Promise<void>

let handler: EmergencyCoreRestartHandler | undefined

export function registerEmergencyCoreRestartHandler(
  next: EmergencyCoreRestartHandler,
): void {
  handler = next
}

export function resetEmergencyCoreRestartHandlerForTests(): void {
  handler = undefined
}

export async function invokeEmergencyCoreRestart(
  input: EmergencyCoreRestartInput,
): Promise<void> {
  if (!handler) {
    throw new Error('emergency_core_restart_handler_unregistered')
  }
  await handler(input)
}
