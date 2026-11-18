// [INPUT] @renderer/utils/core-restart-gate（POS: 内核重启闸门）
// [OUTPUT] useCoreRestarting
// [POS] 「内核重启中」状态订阅：任何入口经 `restartCore()` 触发的重启都会反映到这里，页头据此显示进度，重启类开关据此禁用。
import { useSyncExternalStore } from 'react'
import { coreRestartGate } from '@renderer/utils/core-restart-gate'

export function useCoreRestarting(): boolean {
  return useSyncExternalStore(coreRestartGate.subscribe, coreRestartGate.isBusy)
}
