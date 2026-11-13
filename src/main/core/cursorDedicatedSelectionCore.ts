// [INPUT] 无本地依赖
// [OUTPUT] CursorDedicatedManualSelection · resolveCursorDedicatedSelectionPath · readCursorDedicatedManualSelection · writeCursorDedicatedManualSelection
// [POS] Cursor 专用组用户手选节点的持久化：`~/.sparkle/cursor-dedicated-selection.json`（`SPARKLE_CURSOR_SELECTION_FILE` 可覆盖）；读失败或空值返回 undefined，空节点名不写。

import { mkdir, readFile, writeFile } from 'fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface CursorDedicatedManualSelection {
  node: string
  updatedAtMs: number
}

export function resolveCursorDedicatedSelectionPath(): string {
  const override = process.env.SPARKLE_CURSOR_SELECTION_FILE?.trim()
  if (override) {
    return override
  }
  return path.join(process.env.HOME || os.homedir(), '.sparkle', 'cursor-dedicated-selection.json')
}

export async function readCursorDedicatedManualSelection(): Promise<string | undefined> {
  try {
    const raw = await readFile(resolveCursorDedicatedSelectionPath(), 'utf8')
    const parsed = JSON.parse(raw) as CursorDedicatedManualSelection
    const node = typeof parsed.node === 'string' ? parsed.node.trim() : ''
    return node || undefined
  } catch {
    return undefined
  }
}

export async function writeCursorDedicatedManualSelection(node: string): Promise<void> {
  const trimmed = node.trim()
  if (!trimmed) {
    return
  }
  const filePath = resolveCursorDedicatedSelectionPath()
  await mkdir(path.dirname(filePath), { recursive: true })
  const body: CursorDedicatedManualSelection = {
    node: trimmed,
    updatedAtMs: Date.now()
  }
  await writeFile(filePath, JSON.stringify(body), 'utf8')
}
