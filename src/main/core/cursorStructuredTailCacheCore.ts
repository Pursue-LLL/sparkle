// [INPUT] fs stat + readLogFileTail
// [OUTPUT] readStructuredLogTailCached · resetStructuredLogTailCacheForTests
// [POS] P18 — mtime+size keyed tail cache; avoids re-reading 512KB every hung_scan @ ultra-conn.

export interface StructuredTailCacheEntry {
  mtimeMs: number
  size: number
  text: string
}

const tailCache = new Map<string, StructuredTailCacheEntry>()

export async function readStructuredLogTailCached(
  filePath: string,
  maxBytes: number,
  readTail: (path: string, bytes: number) => Promise<string>,
  statFile: (path: string) => Promise<{ mtimeMs: number; size: number }>,
): Promise<string> {
  const stat = await statFile(filePath)
  const cached = tailCache.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.text
  }
  const text = await readTail(filePath, maxBytes)
  tailCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, text })
  return text
}

export function resetStructuredLogTailCacheForTests(): void {
  tailCache.clear()
}
