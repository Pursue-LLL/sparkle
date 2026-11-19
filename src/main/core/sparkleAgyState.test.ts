import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import type * as AgyState from './sparkleAgyState'

const NOW = 1_700_000_000_000
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

describe('sparkleAgyState', () => {
  let root = ''
  let dataDir = ''
  let store: typeof AgyState
  const stateFile = (): string => path.join(dataDir, 'sparkle-agy-state.json')

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sparkle-agy-state-'))
    mock.module('../utils/dirs', { exports: { dataDir: () => dataDir } })
    store = require('./sparkleAgyState') as typeof AgyState
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    dataDir = path.join(root, 'data')
    rmSync(dataDir, { recursive: true, force: true })
    mkdirSync(dataDir, { recursive: true })
  })

  it('starts from a healthy, empty state when there is no state file', async () => {
    const { state } = await store.openAgyState(NOW)

    assert.deepEqual(state, {
      phase: 'healthy',
      emptyRounds: 0,
      repairSkipUntilMs: 0,
      pinUnknownStreak: 0,
      attempts: new Map()
    })
  })

  it('starts from the default state when the file is corrupt or not an object', async () => {
    for (const content of ['', '{"phase":', 'null', '[1,2]', '"healthy"', '42']) {
      writeFileSync(stateFile(), content, 'utf8')

      const { state } = await store.openAgyState(NOW)

      assert.equal(state.phase, 'healthy', content)
      assert.equal(state.emptyRounds, 0, content)
      assert.equal(state.attempts.size, 0, content)
    }
  })

  it('restores what the previous process committed', async () => {
    const first = await store.openAgyState(NOW)
    first.state.phase = 'exhausted'
    first.state.emptyRounds = 2
    first.state.repairSkipUntilMs = NOW + 30 * MINUTE_MS
    first.state.pinUnknownStreak = 1
    first.state.attempts.set('node-a', NOW - 5 * MINUTE_MS)
    await first.commit()

    const second = await store.openAgyState(NOW + MINUTE_MS)

    assert.deepEqual(second.state, first.state)
  })

  it('falls back field by field, keeping the valid ones', async () => {
    writeFileSync(
      stateFile(),
      JSON.stringify({
        phase: 'bogus',
        emptyRounds: -1,
        repairSkipUntilMs: 'soon',
        pinUnknownStreak: 3,
        attempts: { good: NOW - MINUTE_MS, text: 'yesterday', missing: null }
      }),
      'utf8'
    )

    const { state } = await store.openAgyState(NOW)

    assert.equal(state.phase, 'healthy')
    assert.equal(state.emptyRounds, 0)
    assert.equal(state.repairSkipUntilMs, 0)
    assert.equal(state.pinUnknownStreak, 3)
    assert.deepEqual([...state.attempts], [['good', NOW - MINUTE_MS]])
  })

  it('drops attempts older than the retention window and keeps the rest', async () => {
    writeFileSync(
      stateFile(),
      JSON.stringify({
        attempts: {
          fresh: NOW - 1,
          insideWindow: NOW - HOUR_MS,
          outsideWindow: NOW - HOUR_MS - 1
        }
      }),
      'utf8'
    )

    const { state } = await store.openAgyState(NOW)

    assert.deepEqual([...state.attempts.keys()].sort(), ['fresh', 'insideWindow'])
  })

  it('writes nothing when nothing changed, and only once per change', async () => {
    const handle = await store.openAgyState(NOW)
    await handle.commit()
    assert.equal(existsSync(stateFile()), false)

    handle.state.emptyRounds = 1
    await handle.commit()
    assert.equal(JSON.parse(readFileSync(stateFile(), 'utf8')).emptyRounds, 1)

    rmSync(stateFile())
    await handle.commit()
    assert.equal(existsSync(stateFile()), false)
  })

  it('reports a failed write and retries it on the next commit', async () => {
    const handle = await store.openAgyState(NOW)
    handle.state.phase = 'repairing'
    rmSync(dataDir, { recursive: true, force: true })

    await assert.rejects(handle.commit())

    mkdirSync(dataDir, { recursive: true })
    await handle.commit()
    assert.equal(JSON.parse(readFileSync(stateFile(), 'utf8')).phase, 'repairing')
  })
})
