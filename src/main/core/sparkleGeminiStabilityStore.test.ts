import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import {
  isNodeStable,
  PENALTY_BURST_LIMIT,
  PENALTY_BURST_WINDOW_MS,
  STABLE_CLEAN_WINDOW_MS,
  STABLE_MIN_SAMPLES
} from './sparkleGeminiStabilityCore'
import type * as StabilityStore from './sparkleGeminiStabilityStore'

const NOW = 1_700_000_000_000
const LEDGER_FILENAME = 'sparkle-gemini-stability.json'

describe('sparkleGeminiStabilityStore', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkle-gemini-stability-'))
  const state = { dir: root, logs: [] as string[] }
  let store: typeof StabilityStore

  const ledgerFile = (): string => path.join(state.dir, LEDGER_FILENAME)
  const readLedgerFile = (): Record<string, unknown> =>
    JSON.parse(readFileSync(ledgerFile(), 'utf8'))
  const logged = (fragment: string): boolean => state.logs.some((line) => line.includes(fragment))

  before(() => {
    mock.module('../utils/dirs', { exports: { dataDir: (): string => state.dir } })
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          state.logs.push(line)
        }
      }
    })
  })

  beforeEach(() => {
    state.dir = path.join(root, `case-${Math.random().toString(36).slice(2)}`)
    mkdirSync(state.dir)
    state.logs = []
    delete require.cache[require.resolve('./sparkleGeminiStabilityStore')]
    store = require('./sparkleGeminiStabilityStore') as typeof StabilityStore
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('starts empty and quiet when there is no ledger file yet', async () => {
    assert.equal((await store.loadGeminiStabilityLedger()).size, 0)
    assert.deepEqual(state.logs, [])
  })

  it('loads the saved ledger and counts a block time from the future as happening now', async () => {
    writeFileSync(
      ledgerFile(),
      JSON.stringify({ 日本: { samples: 20 }, 台湾: { samples: 8, lastBadAt: 4_102_444_800_000 } })
    )

    const ledger = await store.loadGeminiStabilityLedger()

    assert.deepEqual(ledger.get('日本'), { samples: 20 })
    const taiwan = ledger.get('台湾')
    assert.equal(taiwan?.samples, 8)
    assert.ok((taiwan?.lastBadAt ?? Infinity) <= Date.now(), 'clamped to the present')
  })

  it('starts empty and says so when the ledger file is unreadable', async () => {
    writeFileSync(ledgerFile(), '{not json')

    assert.equal((await store.loadGeminiStabilityLedger()).size, 0)
    assert.ok(logged('ledger unreadable, starting empty'))
  })

  it('reads the file once and serves the same memory afterwards', async () => {
    writeFileSync(ledgerFile(), JSON.stringify({ first: { samples: 1 } }))
    const first = await store.loadGeminiStabilityLedger()

    writeFileSync(ledgerFile(), JSON.stringify({ second: { samples: 1 } }))

    assert.equal(await store.loadGeminiStabilityLedger(), first)
    assert.deepEqual([...first.keys()], ['first'])
  })

  it('counts each verdict, remembers when a node was last blocked, and writes it through', async () => {
    await store.noteGeminiRegionSample('日本', false, NOW)
    await store.noteGeminiRegionSample('日本', true, NOW + 1000)
    await store.noteGeminiRegionSample('日本', false, NOW + 2000)

    assert.deepEqual(readLedgerFile(), { 日本: { samples: 3, lastBadAt: NOW + 1000 } })
    assert.equal(existsSync(`${ledgerFile()}.tmp`), false)
    assert.deepEqual((await store.loadGeminiStabilityLedger()).get('日本'), {
      samples: 3,
      lastBadAt: NOW + 1000
    })
  })

  it('says when a node becomes stable and when it loses that status', async () => {
    for (let round = 0; round < STABLE_MIN_SAMPLES; round++) {
      await store.noteGeminiRegionSample('日本', false, NOW + round)
    }
    assert.ok(logged(`node "日本" became stable (samples=${STABLE_MIN_SAMPLES})`))
    state.logs = []

    await store.noteGeminiRegionSample('日本', true, NOW + 100)

    assert.ok(logged(`node "日本" lost stable status (samples=${STABLE_MIN_SAMPLES + 1})`))
    const entry = (await store.loadGeminiStabilityLedger()).get('日本')
    assert.equal(isNodeStable(entry, NOW + 100 + STABLE_CLEAN_WINDOW_MS - 1), false)
    assert.equal(isNodeStable(entry, NOW + 100 + STABLE_CLEAN_WINDOW_MS), true)
  })

  it('says nothing about a node that was never trusted in the first place', async () => {
    await store.noteGeminiRegionSample('台湾', true, NOW)

    assert.deepEqual(state.logs, [])
  })

  it('stops charging penalties once the burst limit is used up, and never throttles clear verdicts', async () => {
    for (let node = 0; node < PENALTY_BURST_LIMIT; node++) {
      await store.noteGeminiRegionSample(`节点${node}`, true, NOW + node)
    }

    await store.noteGeminiRegionSample('第三个', true, NOW + 10)
    await store.noteGeminiRegionSample('第三个', false, NOW + 20)

    const ledger = await store.loadGeminiStabilityLedger()
    assert.deepEqual(ledger.get('第三个'), { samples: 1 }, 'only the clear verdict counted')
    assert.ok(logged('skipped penalty for "第三个"'))
  })

  it('does not charge repeat verdicts on an already penalized node to the burst limit', async () => {
    await store.noteGeminiRegionSample('长期被封', true, NOW)
    for (let repeat = 1; repeat <= PENALTY_BURST_LIMIT; repeat++) {
      await store.noteGeminiRegionSample('长期被封', true, NOW + repeat)
    }

    for (let node = 0; node < PENALTY_BURST_LIMIT - 1; node++) {
      await store.noteGeminiRegionSample(`偶发翻转${node}`, true, NOW + 100 + node)
    }

    const ledger = await store.loadGeminiStabilityLedger()
    assert.equal(ledger.get('长期被封')?.samples, PENALTY_BURST_LIMIT + 1, 'every repeat counted')
    for (let node = 0; node < PENALTY_BURST_LIMIT - 1; node++) {
      assert.equal(ledger.get(`偶发翻转${node}`)?.lastBadAt, NOW + 100 + node)
    }
    assert.equal(logged('skipped penalty'), false)
  })

  it('charges a node whose penalty period is over as a newly penalized node again', async () => {
    await store.noteGeminiRegionSample('旧案', true, NOW)
    const later = NOW + STABLE_CLEAN_WINDOW_MS
    for (let node = 0; node < PENALTY_BURST_LIMIT - 1; node++) {
      await store.noteGeminiRegionSample(`新案${node}`, true, later + node)
    }

    await store.noteGeminiRegionSample('旧案', true, later + 10)
    await store.noteGeminiRegionSample('多余的', true, later + 20)

    const ledger = await store.loadGeminiStabilityLedger()
    assert.equal(ledger.get('旧案')?.lastBadAt, later + 10, 'took the last of the quota')
    assert.equal(ledger.get('多余的'), undefined)
    assert.ok(logged('skipped penalty for "多余的"'))
  })

  it('charges penalties again once the earlier ones are a full window old', async () => {
    for (let node = 0; node < PENALTY_BURST_LIMIT; node++) {
      await store.noteGeminiRegionSample(`节点${node}`, true, NOW)
    }

    await store.noteGeminiRegionSample('晚到的', true, NOW + PENALTY_BURST_WINDOW_MS)

    assert.deepEqual((await store.loadGeminiStabilityLedger()).get('晚到的'), {
      samples: 1,
      lastBadAt: NOW + PENALTY_BURST_WINDOW_MS
    })
  })

  it('keeps the verdict in memory and says so when the ledger cannot be written', async () => {
    state.dir = path.join(root, 'missing-dir')

    await store.noteGeminiRegionSample('日本', false, NOW)

    assert.deepEqual((await store.loadGeminiStabilityLedger()).get('日本'), { samples: 1 })
    assert.ok(logged('ledger not persisted'))
  })
})
