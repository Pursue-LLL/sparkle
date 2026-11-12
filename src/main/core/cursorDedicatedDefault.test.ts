import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import {
  applyCursorDedicatedVpsSelection,
  CURSOR_DEFAULT_VPS_NODE,
  resolveCursorDefaultVpsNode,
  shouldApplyCursorDedicatedDefault
} from './cursorDedicatedDefault'
import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'

describe('cursorDedicatedDefault', () => {
  it('prefers Reality as bootstrap default', () => {
    assert.equal(CURSOR_DEFAULT_VPS_NODE, 'KR-VPS-Reality')
    assert.equal(resolveCursorDefaultVpsNode(new Set(['KR-VPS-Reality'])), 'KR-VPS-Reality')
    assert.equal(resolveCursorDefaultVpsNode(new Set(['KR-VPS-HY2'])), undefined)
  })

  it('prefers Reality over HY2 when available', () => {
    assert.equal(
      resolveCursorDefaultVpsNode(new Set(['KR-VPS-Reality', 'KR-VPS-HY2'])),
      'KR-VPS-Reality'
    )
  })

  it('does not override an existing Cursor dedicated selection on bootstrap', () => {
    assert.equal(shouldApplyCursorDedicatedDefault(undefined), true)
    assert.equal(shouldApplyCursorDedicatedDefault('SDK DNS'), true)
    assert.equal(shouldApplyCursorDedicatedDefault('Sparkle-新加坡'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('KR-VPS-TUIC'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('KR-VPS-Reality'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('DIRECT'), false)
  })
})

type Api = Parameters<typeof applyCursorDedicatedVpsSelection>[0]
type Groups = Awaited<ReturnType<Api['mihomoGroups']>>

interface Change {
  group: string
  node: string
  source: unknown
}

const logs: string[] = []
const changes: Change[] = []
let changeResult = true
let selectionFile = ''
let tempDir = ''

/** Cursor 专用组：now 是当前选中，members 是组内成员名（允许夹杂非法条目）。 */
function cursorGroups(now: string | undefined, members: unknown[]): Groups {
  return [
    {
      name: CURSOR_DEDICATED_GROUP_NAME,
      now,
      all: members.map((name) => (name === null ? null : { name }))
    }
  ] as unknown as Groups
}

function apiFor(groups: Groups | undefined): Api {
  return {
    mihomoGroups: async () => groups as Groups,
    mihomoChangeProxy: async (group: string, node: string, options?: { source?: unknown }) => {
      changes.push({ group, node, source: options?.source })
      return changeResult
    }
  } as unknown as Api
}

describe('applyCursorDedicatedVpsSelection', () => {
  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sparkle-cursor-default-'))
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          logs.push(line)
        }
      }
    })
  })

  after(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    logs.length = 0
    changes.length = 0
    changeResult = true
    selectionFile = path.join(tempDir, 'cursor-dedicated-selection.json')
    rmSync(selectionFile, { force: true })
    process.env.SPARKLE_CURSOR_SELECTION_FILE = selectionFile
  })

  afterEach(() => {
    delete process.env.SPARKLE_CURSOR_SELECTION_FILE
  })

  describe('preconditions', () => {
    it('refuses an api that lacks any of the controller calls', async () => {
      const complete = apiFor(cursorGroups('SDK DNS', ['SDK DNS', 'KR-VPS-Reality']))

      for (const partial of [
        {},
        { mihomoGroups: complete.mihomoGroups },
        { mihomoChangeProxy: complete.mihomoChangeProxy }
      ]) {
        await assert.rejects(
          applyCursorDedicatedVpsSelection(partial as unknown as Api),
          /mihomoApi exports missing/
        )
      }
    })

    it('does nothing without groups, or without the Cursor group', async () => {
      assert.equal(await applyCursorDedicatedVpsSelection(apiFor(undefined)), false)
      assert.equal(await applyCursorDedicatedVpsSelection(apiFor([])), false)
      assert.equal(
        await applyCursorDedicatedVpsSelection(
          apiFor([{ name: 'other', all: [] }] as unknown as Groups)
        ),
        false
      )
      assert.deepEqual(changes, [])
    })
  })

  describe('with a node the user chose by hand', () => {
    beforeEach(() => {
      writeFileSync(selectionFile, JSON.stringify({ node: ' KR-VPS-HY2 ', updatedAtMs: 1 }))
    })

    it('puts the chosen node back when something else is selected', async () => {
      const api = apiFor(cursorGroups('DIRECT', ['DIRECT', 'KR-VPS-HY2', 'KR-VPS-Reality']))

      assert.equal(await applyCursorDedicatedVpsSelection(api), true)

      assert.deepEqual(changes, [
        { group: CURSOR_DEDICATED_GROUP_NAME, node: 'KR-VPS-HY2', source: 'manual' }
      ])
      assert.deepEqual(logs, ['[CursorDedicatedDefault]: restore manual selection → KR-VPS-HY2\n'])
    })

    it('does nothing when the chosen node is already selected', async () => {
      const api = apiFor(cursorGroups('KR-VPS-HY2', ['KR-VPS-HY2', 'KR-VPS-Reality']))

      assert.equal(await applyCursorDedicatedVpsSelection(api), false)

      assert.deepEqual(changes, [])
    })

    it('reports nothing restored when the controller refuses the change', async () => {
      changeResult = false
      const api = apiFor(cursorGroups('DIRECT', ['DIRECT', 'KR-VPS-HY2']))

      assert.equal(await applyCursorDedicatedVpsSelection(api), false)

      assert.equal(changes.length, 1)
      assert.deepEqual(logs, [])
    })

    it('recognises a chosen node whose name is a single character', async () => {
      writeFileSync(selectionFile, JSON.stringify({ node: 'X' }))
      const api = apiFor(cursorGroups('DIRECT', ['DIRECT', 'X']))

      assert.equal(await applyCursorDedicatedVpsSelection(api), true)

      assert.deepEqual(changes, [
        { group: CURSOR_DEDICATED_GROUP_NAME, node: 'X', source: 'manual' }
      ])
    })

    it('falls back to the default when the chosen node left the group', async () => {
      const api = apiFor(cursorGroups('SDK DNS', ['SDK DNS', 'KR-VPS-Reality']))

      assert.equal(await applyCursorDedicatedVpsSelection(api), true)

      assert.deepEqual(changes, [
        { group: CURSOR_DEDICATED_GROUP_NAME, node: 'KR-VPS-Reality', source: 'bootstrap' }
      ])
    })
  })

  describe('with no node chosen by hand', () => {
    it('seeds the default VPS node when nothing real is selected yet', async () => {
      for (const now of [undefined, 'SDK DNS']) {
        changes.length = 0
        logs.length = 0
        const api = apiFor(cursorGroups(now, ['SDK DNS', 'KR-VPS-Reality']))

        assert.equal(await applyCursorDedicatedVpsSelection(api), true)

        assert.deepEqual(changes, [
          { group: CURSOR_DEDICATED_GROUP_NAME, node: 'KR-VPS-Reality', source: 'bootstrap' }
        ])
        assert.deepEqual(logs, [
          `[CursorDedicatedDefault]: ${CURSOR_DEDICATED_GROUP_NAME} → KR-VPS-Reality\n`
        ])
      }
    })

    it('leaves a real selection alone, including DIRECT', async () => {
      for (const now of ['DIRECT', 'Sparkle-新加坡', 'KR-VPS-TUIC']) {
        const api = apiFor(cursorGroups(now, [now, 'KR-VPS-Reality']))

        assert.equal(await applyCursorDedicatedVpsSelection(api), false, now)
      }

      assert.deepEqual(changes, [])
    })

    it('does nothing when the default is already selected', async () => {
      const api = apiFor(cursorGroups('KR-VPS-Reality', ['KR-VPS-Reality']))

      assert.equal(await applyCursorDedicatedVpsSelection(api), false)

      assert.deepEqual(changes, [])
    })

    it('says so and stops when the group has no trusted VPS node', async () => {
      const api = apiFor(cursorGroups('SDK DNS', ['SDK DNS', 'KR-VPS-HY2', '', null, 7]))

      assert.equal(await applyCursorDedicatedVpsSelection(api), false)

      assert.deepEqual(changes, [])
      assert.deepEqual(logs, [
        '[CursorDedicatedDefault]: skip — no trusted standard TLS VPS node in group.all (2 members: SDK DNS, KR-VPS-HY2)\n'
      ])
    })

    it('reports nothing seeded when the controller refuses the change', async () => {
      changeResult = false
      const api = apiFor(cursorGroups('SDK DNS', ['SDK DNS', 'KR-VPS-Reality']))

      assert.equal(await applyCursorDedicatedVpsSelection(api), false)

      assert.equal(changes.length, 1)
      assert.deepEqual(logs, [])
    })

    it('ignores a selection file that holds no usable node', async () => {
      for (const body of [
        'not json',
        JSON.stringify({ node: 7 }),
        JSON.stringify({ node: '  ' })
      ]) {
        writeFileSync(selectionFile, body)
        changes.length = 0
        const api = apiFor(cursorGroups('SDK DNS', ['SDK DNS', 'KR-VPS-Reality']))

        assert.equal(await applyCursorDedicatedVpsSelection(api), true, body)

        assert.equal(changes[0].source, 'bootstrap', body)
      }
    })
  })
})
