import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GROK_DEDICATED_GROUP_NAME as RENDERER_GROK_GROUP_NAME } from '../../renderer/src/utils/cursor-proxy-groups'
import { deepMerge } from '../utils/merge'
import {
  AGY_DEDICATED_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  GEMINI_DEDICATED_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'
import {
  DEDICATED_GROUP_IDS,
  DEDICATED_GROUPS,
  dedicatedGroupIdOf,
  newlyEnabledGroupIds,
  resolveDedicatedGroupSwitches,
  runWhenEnabled
} from './dedicatedGroups'
import { ALL_GROUPS_OFF, ALL_GROUPS_ON } from './dedicatedGroupsRig'
import { groupDisplayRank } from './proxyGroupOrder'

describe('DEDICATED_GROUPS registry', () => {
  it('lists the four toggleable groups in their on-screen order', () => {
    assert.deepEqual(DEDICATED_GROUP_IDS, ['grok', 'gemini', 'mail', 'agy'])
    const ranks = DEDICATED_GROUP_IDS.map((id) => groupDisplayRank(DEDICATED_GROUPS[id].name))
    assert.deepEqual(
      ranks,
      [...ranks].sort((a, b) => a - b),
      'placeholders are placed by rank, so the registry order must follow it'
    )
    assert.equal(new Set(ranks).size, ranks.length)
  })

  it('is the single source of the group names every other module uses', () => {
    assert.equal(DEDICATED_GROUPS.grok.name, GROK_DEDICATED_GROUP_NAME)
    assert.equal(DEDICATED_GROUPS.gemini.name, GEMINI_DEDICATED_GROUP_NAME)
    assert.equal(DEDICATED_GROUPS.mail.name, MAIL_DEDICATED_GROUP_NAME)
    assert.equal(DEDICATED_GROUPS.agy.name, AGY_DEDICATED_GROUP_NAME)
    assert.equal(
      DEDICATED_GROUPS.grok.name,
      RENDERER_GROK_GROUP_NAME,
      'the renderer’s mirrored constant must not drift'
    )
  })

  it('has distinct names, and never claims the groups that carry core routing', () => {
    const names = DEDICATED_GROUP_IDS.map((id) => DEDICATED_GROUPS[id].name)
    assert.equal(new Set(names).size, names.length)
    for (const protectedName of [CURSOR_DEDICATED_GROUP_NAME, MAIL_PROBE_HIDDEN_GROUP_NAME]) {
      assert.equal(dedicatedGroupIdOf(protectedName), undefined, protectedName)
    }
  })

  it('keeps technical vocabulary out of the copy a user reads', () => {
    for (const id of DEDICATED_GROUP_IDS) {
      const { summary } = DEDICATED_GROUPS[id]
      assert.ok(summary.length > 0, id)
      assert.doesNotMatch(summary, /provider|mihomo|yaml|probe|探针|内核|config/i, id)
    }
  })
})

describe('dedicatedGroupIdOf', () => {
  it('maps every group name back to its id', () => {
    for (const id of DEDICATED_GROUP_IDS) {
      assert.equal(dedicatedGroupIdOf(DEDICATED_GROUPS[id].name), id)
    }
  })

  it('says nothing about groups that cannot be switched', () => {
    for (const name of ['自动选择', 'Sparkle-台湾', '🚀 节点选择', '', 'GEMINI专用']) {
      assert.equal(dedicatedGroupIdOf(name), undefined, name)
    }
  })
})

describe('resolveDedicatedGroupSwitches', () => {
  it('falls back to each group’s default when nothing was saved', () => {
    assert.deepEqual(resolveDedicatedGroupSwitches(undefined), {
      grok: false,
      gemini: true,
      mail: true,
      agy: true
    })
    assert.deepEqual(resolveDedicatedGroupSwitches({}), resolveDedicatedGroupSwitches(undefined))
  })

  it('keeps what the user chose and fills in only the rest', () => {
    assert.deepEqual(resolveDedicatedGroupSwitches({ grok: true, gemini: false }), {
      grok: true,
      gemini: false,
      mail: true,
      agy: true
    })
  })

  it('treats an explicit false as a choice, not as missing', () => {
    assert.equal(resolveDedicatedGroupSwitches({ mail: false }).mail, false)
  })

  it('always returns a fresh object', () => {
    assert.notEqual(
      resolveDedicatedGroupSwitches(undefined),
      resolveDedicatedGroupSwitches(undefined)
    )
  })
})

describe('newlyEnabledGroupIds', () => {
  it('lists only the groups that went from off to on, in registry order', () => {
    assert.deepEqual(newlyEnabledGroupIds(ALL_GROUPS_OFF, ALL_GROUPS_ON), DEDICATED_GROUP_IDS)
    assert.deepEqual(
      newlyEnabledGroupIds({ ...ALL_GROUPS_OFF, mail: true }, { ...ALL_GROUPS_ON, mail: true }),
      ['grok', 'gemini', 'agy']
    )
  })

  it('is empty when nothing was switched on', () => {
    assert.deepEqual(newlyEnabledGroupIds(ALL_GROUPS_ON, ALL_GROUPS_ON), [])
    assert.deepEqual(newlyEnabledGroupIds(ALL_GROUPS_ON, ALL_GROUPS_OFF), [])
    assert.deepEqual(newlyEnabledGroupIds(ALL_GROUPS_OFF, ALL_GROUPS_OFF), [])
  })
})

describe('runWhenEnabled', () => {
  it('runs the task while the gate is open', async () => {
    let ran = 0

    await runWhenEnabled(
      async () => true,
      async () => {
        ran += 1
      }
    )

    assert.equal(ran, 1)
  })

  it('skips the task entirely while the gate is closed', async () => {
    let ran = 0

    await runWhenEnabled(
      async () => false,
      async () => {
        ran += 1
      }
    )

    assert.equal(ran, 0)
  })

  it('asks the gate every time, so a switch takes effect on the very next call', async () => {
    let open = false
    let ran = 0
    const gate = async (): Promise<boolean> => open
    const task = async (): Promise<void> => {
      ran += 1
    }

    await runWhenEnabled(gate, task)
    open = true
    await runWhenEnabled(gate, task)
    open = false
    await runWhenEnabled(gate, task)

    assert.equal(ran, 1)
  })

  it('surfaces an unreadable switch without running the task', async () => {
    let ran = 0

    await assert.rejects(
      runWhenEnabled(
        async () => {
          throw new Error('config unreadable')
        },
        async () => {
          ran += 1
        }
      ),
      { message: 'config unreadable' }
    )

    assert.equal(ran, 0)
  })

  it('surfaces the task’s own failure', async () => {
    await assert.rejects(
      runWhenEnabled(
        async () => true,
        async () => {
          throw new Error('probe failed')
        }
      ),
      { message: 'probe failed' }
    )
  })
})

describe('persisting a single switch', () => {
  it('merges one group’s patch into the saved switches without touching the others', () => {
    const saved = { dedicatedGroups: { gemini: false, mail: true } } as AppConfig

    const merged = deepMerge(saved, { dedicatedGroups: { grok: true } })

    assert.deepEqual(merged.dedicatedGroups, { gemini: false, mail: true, grok: true })
  })

  it('lets a switch be turned off again, so false is kept rather than dropped', () => {
    const saved = { dedicatedGroups: { grok: true } } as AppConfig

    const merged = deepMerge(saved, { dedicatedGroups: { grok: false } })

    assert.deepEqual(merged.dedicatedGroups, { grok: false })
    assert.equal(resolveDedicatedGroupSwitches(merged.dedicatedGroups).grok, false)
  })
})
