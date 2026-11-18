import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import {
  DEDICATED_GROUP_IDS,
  DEDICATED_GROUPS,
  resolveDedicatedGroupSwitches,
  type DedicatedGroupId
} from './dedicatedGroups'
import {
  GROUP,
  groupNames,
  loadFactoryRig,
  rulesOf,
  subscription,
  type FactoryRig,
  type Json,
  type RigState
} from './factoryRig'
import { parseRule, RULE_BUILTIN_TARGETS } from './ruleSyntax'

const PROVIDER_BY_GROUP: Record<DedicatedGroupId, string> = {
  grok: 'sparkle-grok',
  gemini: 'gemini专用',
  mail: 'sparkle-mail',
  agy: 'sparkle-agy'
}
const AUTO_SELECT = '自动选择'

/** 订阅 / 用户覆写里手写的规则，直接指向 Sparkle 的专用组：该组关闭后必须被修复，不能留下悬空目标。 */
const USER_RULES_TO_DEDICATED_GROUPS = DEDICATED_GROUP_IDS.map(
  (id) => `DOMAIN-SUFFIX,user-${id}.example,${DEDICATED_GROUPS[id].name}`
)

/** 把 16 种开关组合都枚举出来：每一位对应 DEDICATED_GROUP_IDS 中的一个组。 */
function allCombinations(): DedicatedGroupSwitches[] {
  return Array.from({ length: 1 << DEDICATED_GROUP_IDS.length }, (_, mask) =>
    Object.fromEntries(DEDICATED_GROUP_IDS.map((id, bit) => [id, Boolean(mask & (1 << bit))]))
  ) as unknown as DedicatedGroupSwitches[]
}

const describeCombination = (switches: DedicatedGroupSwitches): string =>
  DEDICATED_GROUP_IDS.map((id) => `${id}=${switches[id] ? 'on' : 'off'}`).join(' ')

/** 配置里所有「引用」都能在同一份配置里找到对象：规则目标、组成员、provider 引用、监听器出口。 */
function danglingReferences(config: Json): string[] {
  const names = new Set(groupNames(config))
  const providers = new Set(Object.keys((config['proxy-providers'] as Json | undefined) ?? {}))
  const problems: string[] = []

  for (const rule of rulesOf(config)) {
    const policy = parseRule(rule)?.policy
    if (policy === undefined) {
      problems.push(`unparsable rule: ${rule}`)
    } else if (!names.has(policy) && !RULE_BUILTIN_TARGETS.has(policy)) {
      problems.push(`rule target missing: ${rule}`)
    }
  }
  for (const group of config['proxy-groups'] as Array<Json & { name: string }>) {
    for (const member of (group.proxies as string[] | undefined) ?? []) {
      if (!names.has(member) && !RULE_BUILTIN_TARGETS.has(member)) {
        problems.push(`group ${group.name}: member missing: ${member}`)
      }
    }
    for (const provider of (group.use as string[] | undefined) ?? []) {
      if (!providers.has(provider)) {
        problems.push(`group ${group.name}: provider missing: ${provider}`)
      }
    }
  }
  for (const listener of (config.listeners as Array<{ proxy: string }> | undefined) ?? []) {
    if (!names.has(listener.proxy)) {
      problems.push(`listener target missing: ${listener.proxy}`)
    }
  }
  return problems
}

describe('factory: 专用组开关', () => {
  let rig: FactoryRig
  let state: RigState

  const generateWith = (patch: Partial<DedicatedGroupSwitches> | undefined): Promise<Json> => {
    state.appConfig = patch === undefined ? {} : { dedicatedGroups: patch }
    return rig.generate()
  }

  before(async () => {
    rig = await loadFactoryRig()
    state = rig.state
  })
  beforeEach(() => rig.reset())
  after(() => rig.dispose())

  it('keeps the grok group off and the other three on when nothing was configured', async () => {
    const config = await generateWith(undefined)

    for (const id of DEDICATED_GROUP_IDS) {
      assert.equal(
        groupNames(config).includes(DEDICATED_GROUPS[id].name),
        DEDICATED_GROUPS[id].defaultEnabled,
        id
      )
    }
  })

  it('injects the group, its provider and its rules together once the switch is on', async () => {
    const config = await generateWith({ grok: true })

    assert.ok(groupNames(config).includes('grok 专用'))
    assert.ok('sparkle-grok' in (config['proxy-providers'] as Json))
    assert.ok(rulesOf(config).includes('DOMAIN-SUFFIX,grok.com,grok 专用'))
  })

  for (const id of DEDICATED_GROUP_IDS) {
    it(`removes the ${id} group, provider and rules together once its switch is off`, async () => {
      const on = await generateWith({ [id]: true })
      const off = await generateWith({ [id]: false })
      const name = DEDICATED_GROUPS[id].name

      assert.ok(groupNames(on).includes(name), 'precondition: the group exists while on')
      assert.ok(!groupNames(off).includes(name))
      assert.ok(
        PROVIDER_BY_GROUP[id] in (on['proxy-providers'] as Json),
        'provider exists while on'
      )
      assert.ok(!(PROVIDER_BY_GROUP[id] in (off['proxy-providers'] as Json)))
      assert.equal(
        rulesOf(off).some((rule) => parseRule(rule)?.policy === name),
        false,
        `no rule may still target ${name}`
      )
    })
  }

  it('sends agy traffic through the auto-select group while the agy group is off', async () => {
    const rules = rulesOf(await generateWith({ agy: false }))

    assert.ok(rules.includes(`DOMAIN-KEYWORD,cloudcode-pa,${AUTO_SELECT}`))
  })

  it('hands the resolved switches to the provider file writer', async () => {
    await generateWith({ gemini: false, grok: true })

    assert.deepEqual(
      state.providerFileWrites.at(-1)?.[2],
      resolveDedicatedGroupSwitches({ gemini: false, grok: true })
    )
  })

  it('keeps the probe channel and the Cursor / Hong Kong groups whatever the switches say', async () => {
    const config = await generateWith({ grok: false, gemini: false, mail: false, agy: false })

    assert.deepEqual(groupNames(config), [
      AUTO_SELECT,
      '🎯 Cursor 专用',
      '__sparkle_mail_probe__',
      'Sparkle-台湾',
      'Sparkle-日本',
      'Sparkle-香港',
      GROUP
    ])
    assert.deepEqual(config.listeners, [
      {
        name: 'sparkle-mail-probe',
        type: 'mixed',
        listen: '127.0.0.1',
        port: 17899,
        proxy: '__sparkle_mail_probe__'
      }
    ])
  })

  describe('every one of the 16 switch combinations yields a config without dangling references', () => {
    for (const switches of allCombinations()) {
      it(describeCombination(switches), async () => {
        state.profile = subscription({
          rules: [
            ...USER_RULES_TO_DEDICATED_GROUPS,
            `DOMAIN-SUFFIX,example.com,${GROUP}`,
            `MATCH,${GROUP}`
          ]
        })

        const config = await generateWith(switches)

        assert.deepEqual(danglingReferences(config), [])
        for (const id of DEDICATED_GROUP_IDS) {
          assert.equal(groupNames(config).includes(DEDICATED_GROUPS[id].name), switches[id], id)
        }
      })
    }
  })
})
