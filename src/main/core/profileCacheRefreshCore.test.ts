import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import type {
  readProfileDiskUpdatedMs,
  reloadCurrentProfileFromDiskCache
} from './profileCacheRefreshCore'

const state: {
  regenerate: (profileId: string) => Promise<boolean>
  regenerated: string[]
  logs: string[]
} = { regenerate: async () => false, regenerated: [], logs: [] }

describe('profileCacheRefreshCore', () => {
  let readUpdatedMs: typeof readProfileDiskUpdatedMs
  let reloadFromCache: typeof reloadCurrentProfileFromDiskCache
  let profilesDir: string

  before(async () => {
    profilesDir = mkdtempSync(path.join(tmpdir(), 'sparkle-profile-cache-'))
    mock.module('../utils/dirs', {
      exports: {
        profilePath: (profileId: string): string => path.join(profilesDir, `${profileId}.yaml`)
      }
    })
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          state.logs.push(line)
        }
      }
    })
    mock.module('./runtimeConfigSync', {
      exports: {
        regenerateAndSyncProfile: async (profileId: string): Promise<boolean> => {
          state.regenerated.push(profileId)
          return state.regenerate(profileId)
        }
      }
    })
    const loaded = await import('./profileCacheRefreshCore')
    readUpdatedMs = loaded.readProfileDiskUpdatedMs
    reloadFromCache = loaded.reloadCurrentProfileFromDiskCache
  })

  beforeEach(() => {
    state.regenerate = async () => false
    state.regenerated = []
    state.logs = []
  })

  after(() => {
    rmSync(profilesDir, { recursive: true, force: true })
  })

  describe('readProfileDiskUpdatedMs', () => {
    it('is undefined for a profile that has no cached file', async () => {
      assert.equal(await readUpdatedMs('absent'), undefined)
    })

    it('reports when the cached profile file was last written', async () => {
      const file = path.join(profilesDir, 'cached.yaml')
      writeFileSync(file, 'proxies: []', 'utf8')

      assert.equal(await readUpdatedMs('cached'), statSync(file).mtimeMs)
    })
  })

  describe('reloadCurrentProfileFromDiskCache', () => {
    it('regenerates the profile and says the whole config was adopted', async () => {
      state.regenerate = async () => true

      await reloadFromCache('p1')

      assert.deepEqual(state.regenerated, ['p1'])
      assert.deepEqual(state.logs, [
        '[ProfileCacheRefresh]: reloaded profile=p1 source=disk_cache mode=config\n'
      ])
    })

    it('says only the providers were refreshed when no full reload was needed', async () => {
      await reloadFromCache('p2')

      assert.deepEqual(state.logs, [
        '[ProfileCacheRefresh]: reloaded profile=p2 source=disk_cache mode=providers\n'
      ])
    })

    it('reports nothing as reloaded when regenerating fails', async () => {
      state.regenerate = async () => {
        throw new Error('config invalid')
      }

      await assert.rejects(reloadFromCache('p3'), { message: 'config invalid' })
      assert.deepEqual(state.logs, [])
    })
  })
})
