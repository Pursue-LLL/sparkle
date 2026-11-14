import assert from 'node:assert/strict'
import { after, before, describe, it, mock } from 'node:test'
import type { loadFastProviderExclusions } from './sparkleFastProviderExclusions'

describe('loadFastProviderExclusions', () => {
  let load: typeof loadFastProviderExclusions
  const askedAbout: Array<readonly unknown[] | undefined> = []
  const blocked = new Set(['日本-1'])
  const sunk = new Set(['台湾-1'])

  before(async () => {
    mock.module('./sparkleGeminiProbe', {
      exports: {
        loadGeminiBlockedNodeNames: async (
          proxies?: readonly unknown[]
        ): Promise<ReadonlySet<string>> => {
          askedAbout.push(proxies)
          return blocked
        }
      }
    })
    mock.module('./sparkleNodeQualityCache', {
      exports: { loadSunkNodeNames: async (): Promise<ReadonlySet<string>> => sunk }
    })
    load = (await import('./sparkleFastProviderExclusions')).loadFastProviderExclusions
  })

  after(() => {
    mock.restoreAll()
  })

  it('returns both the region-blocked nodes and the sunk nodes', async () => {
    const exclusions = await load([{ name: '台湾-1' }])

    assert.deepEqual(exclusions, { blockedNodeNames: blocked, sunkNodeNames: sunk })
  })

  it('judges the region verdicts against the subscription it was given', async () => {
    const proxies = [{ name: '台湾-1' }, { name: '日本-1' }]

    await load(proxies)

    assert.equal(askedAbout.at(-1), proxies)
  })
})
