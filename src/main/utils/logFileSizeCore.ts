export interface LogFileSizeState {
  path: string
  size: number | null
}

export function resolveCachedLogFileSize(
  state: LogFileSizeState | undefined,
  path: string
): number | null {
  if (state?.path === path && state.size !== null) {
    return state.size
  }
  return null
}

export function nextLogFileSizeAfterAppend(currentSize: number, appendedBytes: number): number {
  return currentSize + appendedBytes
}

export function shouldTrimLogFile(nextSize: number, maxBytes: number): boolean {
  return nextSize > maxBytes
}

export function trimTargetBytes(maxBytes: number, lowWatermarkRatio: number): number {
  return Math.max(1, Math.floor(maxBytes * lowWatermarkRatio))
}
