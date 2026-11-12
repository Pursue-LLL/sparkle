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

export interface TrimmedLogContent {
  /** 裁剪后的内容，换行统一为 LF。 */
  content: string
  /** `content` 的字节数。 */
  size: number
  /** 是否丢过行；false 时文件无需改写。 */
  trimmed: boolean
}

/** 从最旧的整行开始丢，直到内容不超过 targetBytes；末尾是否带换行保持不变。 */
export function trimLogContent(raw: string, targetBytes: number): TrimmedLogContent {
  const normalized = raw.replace(/\r\n/g, '\n')
  const hasTrailingNewline = normalized.endsWith('\n')
  const lines = normalized.split('\n')
  if (hasTrailingNewline) {
    lines.pop()
  }

  let size = Buffer.byteLength(normalized, 'utf-8')
  if (size <= targetBytes) {
    return { content: normalized, size, trimmed: false }
  }

  let startIndex = 0
  while (startIndex < lines.length && size > targetBytes) {
    size -= Buffer.byteLength(lines[startIndex], 'utf-8')
    if (startIndex < lines.length - 1 || hasTrailingNewline) {
      size -= 1
    }
    startIndex++
  }

  const kept = lines.slice(startIndex)
  const content = kept.join('\n') + (kept.length > 0 && hasTrailingNewline ? '\n' : '')
  return { content, size: Buffer.byteLength(content, 'utf-8'), trimmed: true }
}
