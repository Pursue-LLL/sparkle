import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  migrateLegacyCursorDedicatedGroupReferences,
  rewriteBroadCursorDedicatedRules
} from './cursorDedicatedRuleRewrite'
import {
  AUTO_SELECT_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAME,
  PREVIOUS_CURSOR_DEDICATED_GROUP_NAME
} from './cursorProxyGroup'

function profileWith(rules?: string[]): MihomoConfig {
  return { rules } as unknown as MihomoConfig
}

describe('migrateLegacyCursorDedicatedGroupReferences', () => {
  it('leaves a profile without rules alone', () => {
    const missing = profileWith(undefined)
    const empty = profileWith([])

    assert.equal(migrateLegacyCursorDedicatedGroupReferences(missing), false)
    assert.equal(migrateLegacyCursorDedicatedGroupReferences(empty), false)
    assert.equal(missing.rules, undefined)
    assert.deepEqual(empty.rules, [])
  })

  it('points both legacy group names at the current group and reports the change', () => {
    const profile = profileWith([
      `DOMAIN-SUFFIX,cursor.sh,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-SUFFIX,cursor.com,${PREVIOUS_CURSOR_DEDICATED_GROUP_NAME}`,
      'MATCH,自动选择'
    ])

    assert.equal(migrateLegacyCursorDedicatedGroupReferences(profile), true)
    assert.deepEqual(profile.rules, [
      `DOMAIN-SUFFIX,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-SUFFIX,cursor.com,${CURSOR_DEDICATED_GROUP_NAME}`,
      'MATCH,自动选择'
    ])
  })

  it('rewrites every occurrence inside one rule', () => {
    const profile = profileWith([
      `AND,((DOMAIN,a.cursor.sh),(NETWORK,tcp)),${LEGACY_CURSOR_DEDICATED_GROUP_NAME},${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`
    ])

    assert.equal(migrateLegacyCursorDedicatedGroupReferences(profile), true)
    assert.deepEqual(profile.rules, [
      `AND,((DOMAIN,a.cursor.sh),(NETWORK,tcp)),${CURSOR_DEDICATED_GROUP_NAME},${CURSOR_DEDICATED_GROUP_NAME}`
    ])
  })

  it('reports no change when no rule uses a legacy name', () => {
    const rules = [`DOMAIN-SUFFIX,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`, 'MATCH,自动选择']
    const profile = profileWith([...rules])

    assert.equal(migrateLegacyCursorDedicatedGroupReferences(profile), false)
    assert.deepEqual(profile.rules, rules)
  })
})

describe('rewriteBroadCursorDedicatedRules', () => {
  it('leaves a profile without rules alone', () => {
    const missing = profileWith(undefined)
    const empty = profileWith([])

    rewriteBroadCursorDedicatedRules(missing)
    rewriteBroadCursorDedicatedRules(empty)

    assert.equal(missing.rules, undefined)
    assert.deepEqual(empty.rules, [])
  })

  it('keeps rules that really are Cursor traffic', () => {
    const rules = [
      `DOMAIN,cursor.com,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN,cursorapi-eu.example.com,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-SUFFIX,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-SUFFIX,api.cursorapi.com,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-KEYWORD,Cursor,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-KEYWORD,my-cursor-app,${CURSOR_DEDICATED_GROUP_NAME}`
    ]
    const profile = profileWith([...rules])

    rewriteBroadCursorDedicatedRules(profile)

    assert.deepEqual(profile.rules, rules)
  })

  it('sends non-Cursor rules that hijacked general traffic back to auto select', () => {
    const profile = profileWith([
      `DOMAIN-SUFFIX,google.com,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN,www.example.org,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-KEYWORD,openai,${CURSOR_DEDICATED_GROUP_NAME}`,
      `GEOSITE,google,${CURSOR_DEDICATED_GROUP_NAME}`
    ])

    rewriteBroadCursorDedicatedRules(profile)

    assert.deepEqual(profile.rules, [
      `DOMAIN-SUFFIX,google.com,${AUTO_SELECT_GROUP_NAME}`,
      `DOMAIN,www.example.org,${AUTO_SELECT_GROUP_NAME}`,
      `DOMAIN-KEYWORD,openai,${AUTO_SELECT_GROUP_NAME}`,
      `GEOSITE,google,${AUTO_SELECT_GROUP_NAME}`
    ])
  })

  it('matches suffix rules in both directions but not by a mere shared prefix', () => {
    const suffixRule = (payload: string): string =>
      `DOMAIN-SUFFIX,${payload},${CURSOR_DEDICATED_GROUP_NAME}`
    const kept = ['cursor.sh', 'api2.cursor.sh', 'sh'].map(suffixRule)
    const sentBack = ['cursor.sh.evil.example', 'cursora'].map(suffixRule)
    const profile = profileWith([...kept, ...sentBack])

    rewriteBroadCursorDedicatedRules(profile)

    assert.deepEqual(profile.rules, [
      ...kept,
      `DOMAIN-SUFFIX,cursor.sh.evil.example,${AUTO_SELECT_GROUP_NAME}`,
      `DOMAIN-SUFFIX,cursora,${AUTO_SELECT_GROUP_NAME}`
    ])
  })

  it('keeps a keyword rule only when the keyword is about Cursor', () => {
    const profile = profileWith([`DOMAIN-KEYWORD,sh,${CURSOR_DEDICATED_GROUP_NAME}`])

    rewriteBroadCursorDedicatedRules(profile)

    assert.deepEqual(profile.rules, [`DOMAIN-KEYWORD,sh,${AUTO_SELECT_GROUP_NAME}`])
  })

  it('recognises Cursor traffic only in domain rules, whatever the payload looks like', () => {
    const profile = profileWith([
      `PROCESS-NAME,Cursor Helper,${CURSOR_DEDICATED_GROUP_NAME}`,
      `GEOSITE,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
      `IP-CIDR,203.0.113.7/32,${CURSOR_DEDICATED_GROUP_NAME}`
    ])

    rewriteBroadCursorDedicatedRules(profile)

    assert.deepEqual(profile.rules, [
      `PROCESS-NAME,Cursor Helper,${AUTO_SELECT_GROUP_NAME}`,
      `GEOSITE,cursor.sh,${AUTO_SELECT_GROUP_NAME}`,
      `IP-CIDR,203.0.113.7/32,${AUTO_SELECT_GROUP_NAME}`
    ])
  })

  it('only touches rules whose policy is the Cursor group', () => {
    const rules = [
      'DOMAIN-SUFFIX,google.com,🚀 节点选择',
      'DOMAIN-SUFFIX,example.com,DIRECT',
      'GEOIP,CN,DIRECT',
      'MATCH,自动选择'
    ]
    const profile = profileWith([...rules])

    rewriteBroadCursorDedicatedRules(profile)

    assert.deepEqual(profile.rules, rules)
  })

  it('keeps blank lines, comments and malformed short rules exactly as written', () => {
    const rules = ['', '   ', '# DOMAIN-SUFFIX,google.com,🎯 Cursor 专用', 'GEOIP,CN']
    const profile = profileWith([...rules])

    rewriteBroadCursorDedicatedRules(profile)

    assert.deepEqual(profile.rules, rules)
  })

  it('normalizes whitespace only on the rules it rewrites', () => {
    const profile = profileWith([`  DOMAIN-SUFFIX , google.com , ${CURSOR_DEDICATED_GROUP_NAME}  `])

    rewriteBroadCursorDedicatedRules(profile)

    assert.deepEqual(profile.rules, [`DOMAIN-SUFFIX,google.com,${AUTO_SELECT_GROUP_NAME}`])
  })
})
