import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import {
  CURSOR_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES
} from './cursorProxyGroup'
import { apiError, callOf, installMihomoApiMocks, rig } from './mihomoApiRig'
import type * as MihomoApi from './mihomoApi'

type Json = Record<string, unknown>

const node = (name: string): Json => ({ name, type: 'Vless', alive: true })
const group = (name: string, now: string, all: string[], extra: Json = {}): Json => ({
  name,
  type: 'Selector',
  now,
  all,
  ...extra
})

/** 内核对 /proxies 与 /providers/proxies 的应答；其余请求一律记为成功。 */
function serve(proxies: Json, providers: Json = { providers: {} }): void {
  rig.reply = ({ url }) => {
    if (url === '/proxies') return { proxies }
    if (url === '/providers/proxies') return providers
    return {}
  }
}

/** 之后对 provider 列表的请求都以内核错误应答。 */
function providersDown(): void {
  const healthy = rig.reply
  rig.reply = (call) => {
    if (call.url === '/providers/proxies') throw apiError('providers unavailable')
    return healthy(call)
  }
}

const names = (groups: Array<{ name: string }>): string[] => groups.map((entry) => entry.name)

describe('mihomoApi groups and selection', () => {
  let api: typeof MihomoApi
  let selectionDir: string
  let selectionFile: string

  before(async () => {
    selectionDir = mkdtempSync(path.join(tmpdir(), 'sparkle-mihomo-api-'))
    selectionFile = path.join(selectionDir, 'selection.json')
    process.env.SPARKLE_CURSOR_SELECTION_FILE = selectionFile
    installMihomoApiMocks()
    api = await import('./mihomoApi')
  })

  beforeEach(async () => {
    rig.reset()
    rig.reply = () => ({})
    await api.getAxios(true)
    rig.calls = []
    clearSelection()
  })

  after(() => {
    delete process.env.SPARKLE_CURSOR_SELECTION_FILE
    rmSync(selectionDir, { recursive: true, force: true })
  })

  const clearSelection = (): void => rmSync(selectionFile, { force: true })
  const putCalls = (): string[] =>
    rig.calls.filter(({ method }) => method === 'put').map(({ url }) => url)

  describe('mihomoGroups', () => {
    it('returns nothing in direct mode without asking the core anything', async () => {
      rig.mode = 'direct'

      assert.deepEqual(await api.mihomoGroups(), [])
      assert.deepEqual(rig.calls, [])
    })

    it('lists the runtime groups in order, then GLOBAL, with their members resolved', async () => {
      rig.runtime = {
        'proxy-groups': [{ name: '自动选择', url: 'https://probe.example' }, { name: '手动' }]
      }
      serve(
        {
          自动选择: group('自动选择', 'n1', ['n1', 'leaf', 'nowhere']),
          手动: group('手动', '自动选择', ['自动选择']),
          GLOBAL: group('GLOBAL', '手动', ['手动']),
          n1: node('n1')
        },
        { providers: { 'sparkle-fast': { proxies: [node('leaf')] } } }
      )

      const groups = await api.mihomoGroups()

      assert.deepEqual(names(groups), ['自动选择', '手动', 'GLOBAL'])
      assert.equal(groups[0].testUrl, 'https://probe.example')
      assert.equal(groups[1].testUrl, undefined)
      const members = groups[0].all as unknown as Array<{ name: string; type: string }>
      assert.deepEqual(
        members.map(({ name, type }) => [name, type]),
        [
          ['n1', 'Vless'],
          ['leaf', 'Vless'],
          ['nowhere', 'Unknown']
        ]
      )
    })

    it('leaves out hidden groups, plain nodes and groups the core does not know', async () => {
      rig.runtime = {
        'proxy-groups': [{ name: '可见' }, { name: '隐藏' }, { name: '单节点' }, { name: '缺失' }]
      }
      serve({
        可见: group('可见', 'n1', ['n1']),
        隐藏: group('隐藏', 'n1', ['n1'], { hidden: true }),
        单节点: node('单节点'),
        GLOBAL: group('GLOBAL', '可见', ['可见']),
        n1: node('n1')
      })

      assert.deepEqual(names(await api.mihomoGroups()), ['可见', 'GLOBAL'])
    })

    it('adds GLOBAL only once, and not at all while it is hidden', async () => {
      rig.runtime = { 'proxy-groups': [{ name: 'GLOBAL' }] }
      serve({ GLOBAL: group('GLOBAL', 'n1', ['n1']), n1: node('n1') })
      assert.deepEqual(names(await api.mihomoGroups()), ['GLOBAL'])

      rig.runtime = { 'proxy-groups': [] }
      serve({ GLOBAL: group('GLOBAL', 'n1', ['n1'], { hidden: true }), n1: node('n1') })
      assert.deepEqual(names(await api.mihomoGroups()), [])
    })

    it('puts GLOBAL first in global mode', async () => {
      rig.mode = 'global'
      rig.runtime = { 'proxy-groups': [{ name: '手动' }] }
      serve({
        手动: group('手动', 'n1', ['n1']),
        GLOBAL: group('GLOBAL', '手动', ['手动']),
        n1: node('n1')
      })

      assert.deepEqual(names(await api.mihomoGroups()), ['GLOBAL', '手动'])
    })

    it('moves a GLOBAL listed among the groups to the front without losing its neighbours', async () => {
      rig.mode = 'global'
      rig.runtime = { 'proxy-groups': [{ name: '甲' }, { name: 'GLOBAL' }, { name: '乙' }] }
      serve({
        甲: group('甲', 'n1', ['n1']),
        GLOBAL: group('GLOBAL', '甲', ['甲', '乙']),
        乙: group('乙', 'n1', ['n1']),
        n1: node('n1')
      })

      assert.deepEqual(names(await api.mihomoGroups()), ['GLOBAL', '甲', '乙'])
    })

    it('leaves the groups in their order in global mode while GLOBAL is hidden', async () => {
      rig.mode = 'global'
      rig.runtime = { 'proxy-groups': [{ name: '甲' }, { name: '乙' }] }
      serve({
        甲: group('甲', 'n1', ['n1']),
        乙: group('乙', 'n1', ['n1']),
        GLOBAL: group('GLOBAL', 'n1', ['n1'], { hidden: true }),
        n1: node('n1')
      })
      assert.deepEqual(names(await api.mihomoGroups()), ['甲', '乙'])

      rig.runtime = { 'proxy-groups': [] }
      assert.deepEqual(await api.mihomoGroups(), [])
    })

    it('still lists the groups when the provider list is unavailable', async () => {
      rig.runtime = { 'proxy-groups': [{ name: '自动选择' }] }
      serve({
        自动选择: group('自动选择', 'leaf', ['leaf']),
        GLOBAL: group('GLOBAL', '自动选择', ['自动选择'])
      })
      providersDown()

      const [first] = await api.mihomoGroups()

      const members = first.all as unknown as Array<{ name: string; type: string }>
      assert.deepEqual(
        members.map(({ name, type }) => [name, type]),
        [['leaf', 'Unknown']]
      )
    })

    it('falls back to the groups on disk when the runtime has none, and adopts them', async () => {
      rig.runtime = { 'proxy-groups': [] }
      rig.diskRuntime = { 'proxy-groups': [{ name: '自动选择' }] }
      serve({
        自动选择: group('自动选择', 'n1', ['n1']),
        GLOBAL: group('GLOBAL', '自动选择', ['自动选择']),
        n1: node('n1')
      })

      assert.deepEqual(names(await api.mihomoGroups()), ['自动选择', 'GLOBAL'])
      assert.equal(rig.hydrated, 1)
    })

    it('does not touch the disk copy while the runtime has groups, nor adopt an empty one', async () => {
      rig.runtime = { 'proxy-groups': [{ name: '手动' }] }
      rig.diskRuntime = { 'proxy-groups': [{ name: '磁盘' }] }
      serve({
        手动: group('手动', 'n1', ['n1']),
        GLOBAL: group('GLOBAL', '手动', ['手动']),
        n1: node('n1')
      })
      assert.deepEqual(names(await api.mihomoGroups()), ['手动', 'GLOBAL'])

      rig.runtime = undefined
      rig.diskRuntime = undefined
      assert.deepEqual(names(await api.mihomoGroups()), ['GLOBAL'])
      assert.equal(rig.hydrated, 0)
    })
  })

  describe('mihomoChangeProxy', () => {
    const CURSOR = CURSOR_DEDICATED_GROUP_NAME

    function cursorGroupIs(current: string, name: string = CURSOR): void {
      rig.runtime = { 'proxy-groups': [{ name }] }
      serve({
        [name]: group(name, current, [current, 'B'].filter(Boolean)),
        GLOBAL: group('GLOBAL', name, [name]),
        A: node('A'),
        B: node('B')
      })
    }

    it('switches an ordinary group with one request and no group lookup', async () => {
      assert.equal(await api.mihomoChangeProxy('🚀 节点选择', 'n 2'), true)

      assert.deepEqual(rig.calls, [
        callOf('put', `/proxies/${encodeURIComponent('🚀 节点选择')}`, { name: 'n 2' })
      ])
      assert.deepEqual(rig.logs, [])
    })

    it('keeps automatic switching away from the Cursor group once it has a node', async () => {
      cursorGroupIs('A')

      for (const source of ['auto', undefined, 'bootstrap'] as const) {
        const switched = await api.mihomoChangeProxy(CURSOR, 'B', source ? { source } : undefined)

        assert.equal(switched, false, String(source))
      }
      assert.deepEqual(putCalls(), [])
      assert.equal(rig.logs.length, 3)
      assert.equal(
        rig.logs[0],
        `[CursorDedicatedManualOnly]: outcome=blocked source=auto from=A to=B reason=cursor_dedicated_manual_only\n`
      )
      assert.match(rig.logs[2], /source=bootstrap from=A to=B/)
    })

    it('applies the same protection to the legacy Cursor group names', async () => {
      for (const legacy of LEGACY_CURSOR_DEDICATED_GROUP_NAMES) {
        cursorGroupIs('A', legacy)

        assert.equal(await api.mihomoChangeProxy(legacy, 'B'), false, legacy)
      }
      assert.deepEqual(putCalls(), [])
    })

    it('lets a person choose any node, and remembers the choice', async () => {
      cursorGroupIs('A')

      assert.equal(await api.mihomoChangeProxy(CURSOR, 'B', { source: 'manual' }), true)

      assert.deepEqual(putCalls(), [`/proxies/${encodeURIComponent(CURSOR)}`])
      const saved = JSON.parse(readFileSync(selectionFile, 'utf8')) as { node: string }
      assert.equal(saved.node, 'B')
    })

    it('seeds a default only while the Cursor group has no real selection', async () => {
      for (const current of ['', 'SDK DNS']) {
        cursorGroupIs(current)

        assert.equal(
          await api.mihomoChangeProxy(CURSOR, 'B', { source: 'bootstrap' }),
          true,
          current
        )
      }
      assert.equal(putCalls().length, 2)
      assert.throws(() => readFileSync(selectionFile, 'utf8'), { code: 'ENOENT' })
    })

    it('does not block re-applying the node the group already uses', async () => {
      cursorGroupIs('A')

      assert.equal(await api.mihomoChangeProxy(CURSOR, 'A'), true)
      assert.equal(putCalls().length, 1)
    })

    it('does not block a Cursor group the core has not reported yet', async () => {
      rig.runtime = { 'proxy-groups': [] }
      serve({ GLOBAL: group('GLOBAL', 'A', ['A']), A: node('A') })

      assert.equal(await api.mihomoChangeProxy(CURSOR, 'A'), true)
    })

    it('does not remember manual choices made on other groups', async () => {
      await api.mihomoChangeProxy('🚀 节点选择', 'B', { source: 'manual' })

      assert.throws(() => readFileSync(selectionFile, 'utf8'), { code: 'ENOENT' })
    })
  })
})
