import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import type { overrideProfile } from './overrideProfile'

interface Item {
  id: string
  ext?: 'js' | 'yaml'
  global?: boolean
}

const state: {
  config: { items?: Item[] } | undefined
  profileOverrides: string[] | undefined
  contents: Record<string, string>
  reads: Array<[string, string]>
} = { config: undefined, profileOverrides: undefined, contents: {}, reads: [] }

const profileOf = (extra: Record<string, unknown> = {}): MihomoConfig =>
  ({ mode: 'rule', rules: ['MATCH,DIRECT'], ...extra }) as unknown as MihomoConfig

describe('overrideProfile', () => {
  let apply: typeof overrideProfile
  let logDir: string
  const logOf = (id: string): string => readFileSync(path.join(logDir, `${id}.log`), 'utf8')

  before(async () => {
    logDir = mkdtempSync(path.join(tmpdir(), 'sparkle-override-profile-'))
    mock.module('../config', {
      exports: {
        getOverrideConfig: async (): Promise<typeof state.config> => state.config,
        getProfileItem: async (): Promise<{ override?: string[] } | undefined> =>
          state.profileOverrides ? { override: state.profileOverrides } : undefined,
        getOverrideItem: async (id: string): Promise<Item | undefined> =>
          state.config?.items?.find((item) => item.id === id),
        getOverride: async (id: string, ext: string): Promise<string> => {
          state.reads.push([id, ext])
          return state.contents[id] ?? ''
        }
      }
    })
    mock.module('../utils/dirs', {
      exports: {
        overridePath: (id: string, ext: string): string => path.join(logDir, `${id}.${ext}`)
      }
    })
    apply = (await import('./overrideProfile')).overrideProfile
  })

  beforeEach(() => {
    state.config = { items: [] }
    state.profileOverrides = undefined
    state.contents = {}
    state.reads = []
  })

  after(() => {
    rmSync(logDir, { recursive: true, force: true })
  })

  it('returns the profile untouched when nothing is configured', async () => {
    state.config = undefined

    assert.deepEqual(await apply('p1', profileOf()), profileOf())
  })

  it('applies a yaml override as a deep merge with the list operators', async () => {
    state.config = { items: [{ id: 'y1', ext: 'yaml', global: true }] }
    state.contents.y1 = [
      'mode: global',
      'dns:',
      '  enable: true',
      "'+rules':",
      '  - DOMAIN,first.example,DIRECT',
      "'rules+':",
      '  - DOMAIN,last.example,DIRECT'
    ].join('\n')

    const result = await apply('p1', profileOf({ dns: { ipv6: false } }))

    assert.deepEqual(result, {
      mode: 'global',
      dns: { ipv6: false, enable: true },
      rules: ['DOMAIN,first.example,DIRECT', 'MATCH,DIRECT', 'DOMAIN,last.example,DIRECT']
    })
  })

  it('ignores a yaml override whose content is not a mapping', async () => {
    state.config = { items: [{ id: 'y1', ext: 'yaml', global: true }] }
    state.contents.y1 = 'just a sentence'

    assert.deepEqual(await apply('p1', profileOf()), profileOf())
  })

  it('runs a js override and records its output in that override’s log', async () => {
    state.config = { items: [{ id: 'j1', ext: 'js', global: true }] }
    state.contents.j1 = 'function main(p) { console.log("hello"); p.mode = "global"; return p }'

    const result = await apply('p1', profileOf())

    assert.equal(result.mode, 'global')
    assert.equal(logOf('j1'), '[info] 开始执行脚本\n[log] "hello"\n[info] 脚本执行成功\n')
  })

  it('keeps the profile and carries on when a js override fails', async () => {
    state.config = {
      items: [
        { id: 'broken', ext: 'js', global: true },
        { id: 'y1', ext: 'yaml', global: true }
      ]
    }
    state.contents.broken = 'function main() { throw new Error("boom") }'
    state.contents.y1 = 'mode: direct'

    const result = await apply('p1', profileOf())

    assert.equal(result.mode, 'direct', 'the later override still applies')
    assert.match(logOf('broken'), /\[exception\] 脚本执行失败：Error: boom/)
  })

  it('applies global overrides first, then the profile’s own, each exactly once', async () => {
    state.config = {
      items: [
        { id: 'g1', ext: 'yaml', global: true },
        { id: 'p1-only', ext: 'yaml' },
        { id: 'both', ext: 'yaml', global: true },
        { id: 'unused', ext: 'yaml' }
      ]
    }
    state.profileOverrides = ['p1-only', 'both']
    state.contents = { g1: 'order: [g1]', 'p1-only': 'order: [p1]', both: 'order: [both]' }

    const result = await apply('p1', profileOf())

    assert.deepEqual(
      state.reads.map(([id]) => id),
      ['g1', 'both', 'p1-only']
    )
    assert.deepEqual((result as unknown as { order: string[] }).order, ['p1'])
  })

  it('reads an override that has no configured item as a script, without applying it', async () => {
    state.profileOverrides = ['ghost']
    state.contents.ghost = 'function main(p) { p.mode = "global"; return p }'

    const result = await apply('p1', profileOf())

    assert.deepEqual(state.reads, [['ghost', 'js']])
    assert.equal(result.mode, 'rule')
    assert.equal(existsSync(path.join(logDir, 'ghost.log')), false)
  })
})
