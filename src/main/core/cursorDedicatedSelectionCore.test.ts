import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, afterEach } from 'node:test'
import {
  readCursorDedicatedManualSelection,
  resolveCursorDedicatedSelectionPath,
  writeCursorDedicatedManualSelection,
} from './cursorDedicatedSelectionCore'

describe('cursorDedicatedSelectionCore', () => {
  let tmpFile = ''
  let prevOverride: string | undefined

  afterEach(async () => {
    if (prevOverride === undefined) {
      delete process.env.SPARKLE_CURSOR_SELECTION_FILE
    } else {
      process.env.SPARKLE_CURSOR_SELECTION_FILE = prevOverride
    }
    if (tmpFile) {
      await rm(path.dirname(tmpFile), { recursive: true, force: true })
      tmpFile = ''
    }
  })

  it('writes and reads manual cursor node selection', async () => {
    prevOverride = process.env.SPARKLE_CURSOR_SELECTION_FILE
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sparkle-cursor-sel-'))
    tmpFile = path.join(dir, 'cursor-dedicated-selection.json')
    process.env.SPARKLE_CURSOR_SELECTION_FILE = tmpFile

    await writeCursorDedicatedManualSelection('JP-VPS-Reality')
    assert.equal(await readCursorDedicatedManualSelection(), 'JP-VPS-Reality')
    assert.equal(resolveCursorDedicatedSelectionPath(), tmpFile)

    const raw = await readFile(tmpFile, 'utf8')
    const parsed = JSON.parse(raw) as { node: string; updatedAtMs: number }
    assert.equal(parsed.node, 'JP-VPS-Reality')
    assert.equal(typeof parsed.updatedAtMs, 'number')
  })
})
