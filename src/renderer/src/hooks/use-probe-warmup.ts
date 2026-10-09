import { useSyncExternalStore } from 'react'
import { getProbeWarmupActive } from '@renderer/utils/ipc'

const PROBE_WARMUP_CHANGED_CHANNEL = 'probeWarmupChanged'

let active = false
const listeners = new Set<() => void>()
let detachIpc: (() => void) | undefined

function setActive(next: boolean): void {
  if (active === next) return
  active = next
  listeners.forEach((listener) => listener())
}

function attachIpc(): void {
  detachIpc = window.electron.ipcRenderer.on(
    PROBE_WARMUP_CHANGED_CHANNEL,
    (_event, next: boolean) => setActive(next)
  )
  // 事件只在状态变化时推送；首次订阅（页面晚于内核启动打开）需主动拉取当前值。
  getProbeWarmupActive().then(setActive, () => undefined)
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) attachIpc()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      detachIpc?.()
      detachIpc = undefined
    }
  }
}

/** 内核刚启动、批量测速尚未完成：此窗口内的延迟/超时样本不可信。 */
export function useProbeWarmup(): boolean {
  return useSyncExternalStore(subscribe, () => active)
}
