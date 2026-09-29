// [INPUT] hy2ParentByteDeathRecoveryExecutorImpl · mihomoApi · transportLongevityTruth
// [OUTPUT] executeByteDeathParentMutation
// [POS] C-8.12 runtime wrapper — static mihomo imports (Vite bundle-safe).

import { appendAppLog } from '../utils/log'
import { mihomoCloseConnection, mihomoGetConnections } from './mihomoApi'
import { getLastHy2TunnelVitalityAtMs } from './hy2TunnelVitality'
import { resetTransportLongevityHy2ParentChainBirth } from './transportLongevityTruth'
import { executeByteDeathParentMutationWithDeps,
  type ByteDeathParentMutationInput,
  type ByteDeathParentMutationResult,
  type CloseConnectionFn,
  type ResetParentBirthFn } from './hy2ParentByteDeathRecoveryExecutorImpl'

export type {
  ByteDeathParentMutationInput,
  ByteDeathParentMutationResult,
} from './hy2ParentByteDeathRecoveryExecutorImpl'
export type { Hy2LeafConnectionCloseReport } from './hy2ParentByteDeathRecoveryCore'
export { executeLeafCloseBatch } from './hy2ParentByteDeathRecoveryExecutorImpl'

async function fetchFreshConnections(): Promise<ControllerConnectionDetail[]> {
  const snapshot = await mihomoGetConnections()
  return snapshot.connections ?? []
}

const defaultRuntimeDeps = {
  closeFn: mihomoCloseConnection satisfies CloseConnectionFn,
  fetchConnections: fetchFreshConnections,
  appendLog: appendAppLog,
  resetParentBirth: resetTransportLongevityHy2ParentChainBirth satisfies ResetParentBirthFn,
}

export async function executeByteDeathParentMutation(
  input: ByteDeathParentMutationInput,
  deps?: Partial<typeof defaultRuntimeDeps>,
): Promise<ByteDeathParentMutationResult> {
  const lastVitalitySuccessAtMs = input.lastVitalitySuccessAtMs ?? getLastHy2TunnelVitalityAtMs()
  return executeByteDeathParentMutationWithDeps(
    { ...input, lastVitalitySuccessAtMs },
    {
      ...defaultRuntimeDeps,
      ...deps,
    },
  )
}
