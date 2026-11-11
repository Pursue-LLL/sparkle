import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  isUrlTestGroupType,
  resolveGroupPolicy,
  resolveGroupRole,
  type GroupRole
} from './autoSwitchPolicy'
import {
  AGY_DEDICATED_GROUP_NAME,
  AUTO_SELECT_GROUP_NAME,
  CURSOR_AUTO_SELECT_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'

describe('resolveGroupRole', () => {
  it('maps every Sparkle-owned group to its role by name, ignoring the type', () => {
    const expectations: [string, GroupRole][] = [
      [AUTO_SELECT_GROUP_NAME, 'auto-select'],
      [CURSOR_DEDICATED_GROUP_NAME, 'cursor-dedicated'],
      ...LEGACY_CURSOR_DEDICATED_GROUP_NAMES.map((name): [string, GroupRole] => [
        name,
        'cursor-dedicated'
      ]),
      ['Sparkle-台湾', 'regional-auto'],
      ['Sparkle-日本', 'regional-auto'],
      [CURSOR_AUTO_SELECT_GROUP_NAME, 'regional-auto'],
      ['Sparkle-香港', 'regional-auto'],
      ['🇭🇰 香港节点', 'regional-auto'],
      [GROK_DEDICATED_GROUP_NAME, 'probe-dedicated'],
      [MAIL_DEDICATED_GROUP_NAME, 'probe-dedicated'],
      [AGY_DEDICATED_GROUP_NAME, 'probe-dedicated'],
      [MAIL_PROBE_HIDDEN_GROUP_NAME, 'probe-dedicated']
    ]
    for (const [name, role] of expectations) {
      for (const type of [undefined, 'select', 'url-test', 'URLTest', 'fallback']) {
        assert.equal(resolveGroupRole({ name, type }), role, `${name} (${type ?? 'no type'})`)
      }
    }
  })

  it('classifies subscription groups by type, accepting config and controller spellings', () => {
    const selectLike = [undefined, 'select', 'Selector']
    for (const type of selectLike) {
      assert.equal(resolveGroupRole({ name: '🚀 节点选择', type }), 'subscription-select')
    }
    const autoLike = [
      'url-test',
      'URLTest',
      'fallback',
      'Fallback',
      'load-balance',
      'LoadBalance',
      'relay'
    ]
    for (const type of autoLike) {
      assert.equal(resolveGroupRole({ name: '订阅自动', type }), 'subscription-managed')
    }
  })

  it('keeps the subscription 故障转移 group out of the select-group refs by name', () => {
    assert.equal(resolveGroupRole({ name: '故障转移', type: 'select' }), 'subscription-managed')
  })
})

describe('resolveGroupPolicy', () => {
  it('lets the failover engine act on regional auto groups only', () => {
    const cases: [name: string, type: string, failover: boolean][] = [
      [AUTO_SELECT_GROUP_NAME, 'fallback', false],
      ['Sparkle-台湾', 'url-test', true],
      [CURSOR_AUTO_SELECT_GROUP_NAME, 'url-test', true],
      ['Sparkle-香港', 'url-test', true],
      [CURSOR_DEDICATED_GROUP_NAME, 'select', false],
      [GROK_DEDICATED_GROUP_NAME, 'select', false],
      [MAIL_DEDICATED_GROUP_NAME, 'fallback', false],
      ['🚀 节点选择', 'select', false],
      ['订阅自动', 'url-test', false]
    ]
    for (const [name, type, failover] of cases) {
      assert.equal(resolveGroupPolicy({ name, type }).failover, failover, name)
    }
  })

  it('appends auto-switch refs to subscription select groups only', () => {
    assert.equal(
      resolveGroupPolicy({ name: '🚀 节点选择', type: 'select' }).acceptsAutoSwitchRefs,
      true
    )
    for (const name of [
      AUTO_SELECT_GROUP_NAME,
      'Sparkle-台湾',
      CURSOR_AUTO_SELECT_GROUP_NAME,
      CURSOR_DEDICATED_GROUP_NAME,
      GROK_DEDICATED_GROUP_NAME,
      MAIL_DEDICATED_GROUP_NAME,
      AGY_DEDICATED_GROUP_NAME,
      MAIL_PROBE_HIDDEN_GROUP_NAME
    ]) {
      assert.equal(resolveGroupPolicy({ name, type: 'select' }).acceptsAutoSwitchRefs, false, name)
    }
    assert.equal(
      resolveGroupPolicy({ name: '订阅自动', type: 'url-test' }).acceptsAutoSwitchRefs,
      false
    )
  })
})

describe('isUrlTestGroupType', () => {
  it('matches both spellings and nothing else', () => {
    assert.equal(isUrlTestGroupType('url-test'), true)
    assert.equal(isUrlTestGroupType('URLTest'), true)
    assert.equal(isUrlTestGroupType(' urltest '), true)
    for (const type of [undefined, '', 'select', 'Selector', 'Fallback', 'LoadBalance']) {
      assert.equal(isUrlTestGroupType(type), false, String(type))
    }
  })
})

/** 订阅自带、Sparkle 不拥有的分组名常量。 */
const SUBSCRIPTION_OWNED_GROUP_NAMES: ReadonlySet<string> = new Set(['🚀 节点选择'])

function collectGroupNameConstants(): { constant: string; value: string }[] {
  const pattern = /export const ([A-Z_]*GROUP_NAME)\s*=\s*'([^']+)'/g
  return readdirSync(__dirname)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) =>
      [...readFileSync(join(__dirname, file), 'utf8').matchAll(pattern)].map((match) => ({
        constant: match[1],
        value: match[2]
      }))
    )
}

describe('group name coverage', () => {
  const constants = collectGroupNameConstants()

  it('finds the group name constants it is meant to guard', () => {
    const names = constants.map(({ constant }) => constant)
    for (const expected of [
      'AUTO_SELECT_GROUP_NAME',
      'CURSOR_DEDICATED_GROUP_NAME',
      'CURSOR_AUTO_SELECT_GROUP_NAME',
      'HONG_KONG_FILTER_GROUP_NAME',
      'GROK_DEDICATED_GROUP_NAME',
      'MAIL_DEDICATED_GROUP_NAME',
      'AGY_DEDICATED_GROUP_NAME'
    ]) {
      assert.ok(names.includes(expected), `scan lost ${expected}`)
    }
  })

  it('classifies every exported *_GROUP_NAME as a Sparkle-owned role, so new groups cannot skip the policy table', () => {
    for (const { constant, value } of constants) {
      if (SUBSCRIPTION_OWNED_GROUP_NAMES.has(value)) {
        continue
      }
      const role = resolveGroupRole({ name: value, type: 'select' })
      assert.ok(
        role !== 'subscription-select' && role !== 'subscription-managed',
        `${constant} ('${value}') falls through to ${role}: teach resolveGroupRole about it`
      )
    }
  })
})
