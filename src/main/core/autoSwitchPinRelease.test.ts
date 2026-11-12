import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import { flush } from './groupFailoverEngineHarness'
import type { releaseAutoSwitchPins } from './autoSwitchPinRelease'

const logs: string[] = []
const unfixes: string[] = []
const probes: unknown[][] = []
const behavior: {
  loadGroups: () => Promise<ControllerMixedGroup[]>
  probeError: Error | undefined
} = {
  loadGroups: async () => [],
  probeError: undefined
}

function group(
  name: string,
  type: string,
  members: string[],
  fixed?: string
): ControllerMixedGroup {
  return {
    name,
    type,
    fixed,
    all: members.map((member) => ({ name: member }))
  } as ControllerMixedGroup
}

describe('autoSwitchPinRelease wiring', () => {
  let release: typeof releaseAutoSwitchPins

  before(async () => {
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          logs.push(line)
        }
      }
    })
    mock.module('./mihomoApi', {
      exports: {
        mihomoGroups: (): Promise<ControllerMixedGroup[]> => behavior.loadGroups(),
        mihomoUnfixedProxy: async (name: string): Promise<void> => {
          unfixes.push(name)
        },
        mihomoGroupDelay: async (...args: unknown[]): Promise<void> => {
          probes.push(args)
          if (behavior.probeError) {
            throw behavior.probeError
          }
        }
      }
    })
    release = (await import('./autoSwitchPinRelease')).releaseAutoSwitchPins
  })

  beforeEach(() => {
    logs.length = 0
    unfixes.length = 0
    probes.length = 0
    behavior.probeError = undefined
    behavior.loadGroups = async () => [
      group('Sparkle-台湾', 'URLTest', ['A', 'B'], 'A'),
      group('Sparkle-日本', 'URLTest', ['A', 'B'], 'Gone'),
      group('Sparkle-韩国', 'URLTest', ['A', 'B']),
      group('🚀 节点选择', 'Selector', ['A', 'B'], 'A')
    ]
  })

  after(() => {
    mock.restoreAll()
  })

  it('releases every pin on auto-switch groups only, and nudges each group to re-measure', async () => {
    assert.equal(await release('all'), 2)
    await flush()

    assert.deepEqual(unfixes, ['Sparkle-台湾', 'Sparkle-日本'])
    assert.deepEqual(probes, [['Sparkle-台湾'], ['Sparkle-日本']])
    assert.deepEqual(logs, [
      '[AutoSwitchPin]: released Sparkle-台湾 pinned=A reason=cache-restored scope=all\n',
      '[AutoSwitchPin]: released Sparkle-日本 pinned=Gone reason=orphan scope=all\n'
    ])
  })

  it('keeps pins whose node is still a member when only orphans are released', async () => {
    assert.equal(await release('orphans'), 1)

    assert.deepEqual(unfixes, ['Sparkle-日本'])
    assert.match(logs[0], /reason=orphan scope=orphans/)
  })

  it('never lets a failing re-measure disturb the release', async () => {
    behavior.probeError = new Error('probe down')

    assert.equal(await release('all'), 2)
    await flush()

    assert.equal(probes.length, 2)
  })

  it('reports a controller failure in the log instead of throwing', async () => {
    behavior.loadGroups = () => Promise.reject(new Error('controller down'))

    assert.equal(await release('all'), 0)

    assert.deepEqual(unfixes, [])
    assert.deepEqual(logs, ['[AutoSwitchPin]: plan failed scope=all err=controller down\n'])
  })
})
