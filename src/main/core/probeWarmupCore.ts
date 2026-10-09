// [INPUT] begin/end 调用 · 状态变化回调
// [OUTPUT] createProbeWarmupState
// [POS] 内核启动后批量测速窗口标志（纯逻辑，无 electron 依赖）。
// 窗口内 mihomo 的延迟样本是冷启动并发探测的结果，可能是误报；超过 maxMs 仍未结束则自动收口，避免界面一直 loading。

export interface ProbeWarmupState {
  isActive: () => boolean
  begin: () => void
  end: () => void
}

export function createProbeWarmupState(
  onChange: (active: boolean) => void,
  maxMs: number
): ProbeWarmupState {
  let active = false
  let safetyTimer: NodeJS.Timeout | undefined

  const clearSafetyTimer = (): void => {
    if (safetyTimer) {
      clearTimeout(safetyTimer)
      safetyTimer = undefined
    }
  }

  const setActive = (next: boolean): void => {
    if (active === next) {
      return
    }
    active = next
    onChange(next)
  }

  const end = (): void => {
    clearSafetyTimer()
    setActive(false)
  }

  const begin = (): void => {
    clearSafetyTimer()
    safetyTimer = setTimeout(end, maxMs)
    safetyTimer.unref()
    setActive(true)
  }

  return { isActive: () => active, begin, end }
}
