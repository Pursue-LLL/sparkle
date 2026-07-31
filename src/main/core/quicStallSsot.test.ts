import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { after, before, describe, it } from 'node:test'
import {
  parseQuicStallSsotJson,
  quicStallSsotPath,
} from './quicStallSsotCore'
import { writeQuicStallSsotSnapshot } from './quicStallSsot'

describe('quicStallSsot write', () => {
  let tempHome = ''
  let originalHome: string | undefined

  before(async () => {
    originalHome = process.env.HOME
    tempHome = await mkdtemp(join(tmpdir(), 'sparkle-quic-ssot-'))
    process.env.HOME = tempHome
  })

  after(async () => {
    process.env.HOME = originalHome
    await rm(tempHome, { recursive: true, force: true })
  })

  it('atomically writes quic-stall-ssot.json under ~/.sparkle', async () => {
    const nowMs = 1_800_000_000_000
    const written = await writeQuicStallSsotSnapshot({
      maxStallMs: 95_000,
      frozenQuicCursorCount: 2,
      cursorConnectionCount: 18,
      nowMs,
    })
    const path = quicStallSsotPath()
    const text = await readFile(path, 'utf8')
    const parsed = parseQuicStallSsotJson(text)
    assert.deepEqual(parsed, written)
    assert.equal(parsed?.maxStallMs, 95_000)
    assert.equal(parsed?.updatedAtMs, nowMs)
  })
})
