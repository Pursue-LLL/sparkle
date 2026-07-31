import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_DEDICATED_GROUP_NAME,
  resolveCursorStableSelectorGroup
} from './cursorProxyGroup'
import {
  CURSOR_PROCESS_NAMES,
  injectCursorDomainRules,
  stripUnscopedCursorDedicatedRules
} from './cursorRuleInjection'

function ruleLines(profile: MihomoConfig): string[] {
  return ((profile.rules as string[] | undefined) ?? []).map((rule) => rule.trim())
}

describe('resolveCursorStableSelectorGroup', () => {
  it('accepts yaml select and controller Selector types', () => {
    const selectGroup = resolveCursorStableSelectorGroup([
      { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: [] }
    ] as unknown as ControllerMixedGroup[])
    const selectorGroup = resolveCursorStableSelectorGroup([
      { name: CURSOR_DEDICATED_GROUP_NAME, type: 'Selector', proxies: [] }
    ] as unknown as ControllerMixedGroup[])
    assert.equal(selectGroup?.name, CURSOR_DEDICATED_GROUP_NAME)
    assert.equal(selectorGroup?.name, CURSOR_DEDICATED_GROUP_NAME)
  })
})

describe('injectCursorDomainRules', () => {
  const productionLikeProfile = {
    'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['KR-VPS-TUIC'] }],
    rules: ['GEOIP,us,🚀 节点选择', 'MATCH,DIRECT']
  } as unknown as MihomoConfig

  it('scopes domain and PROCESS-PATH-REGEX rules to configured Cursor app bundles', () => {
    injectCursorDomainRules(productionLikeProfile, ['/Applications/Cursor-3.1.15.app'])

    const rules = ruleLines(productionLikeProfile)
    const pathRegex = 'PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/'
    assert.ok(
      rules.some(
        (rule) =>
          rule === `AND,((DOMAIN,cursor-cdn.com),(${pathRegex})),${CURSOR_DEDICATED_GROUP_NAME}`
      )
    )
    assert.ok(rules.some((rule) => rule === `${pathRegex},${CURSOR_DEDICATED_GROUP_NAME}`))
    assert.ok(!rules.some((rule) => rule.startsWith('PROCESS-NAME,')))
    assert.ok(!rules.some((rule) => rule === `DOMAIN,cursor-cdn.com,${CURSOR_DEDICATED_GROUP_NAME}`))
    assert.ok(!rules.some((rule) => rule.startsWith('PROCESS-PATH,/Applications/')))

    const geoipIndex = rules.indexOf('GEOIP,us,🚀 节点选择')
    const dedicatedPathIndex = rules.findIndex((rule) => rule === `${pathRegex},${CURSOR_DEDICATED_GROUP_NAME}`)
    assert.ok(dedicatedPathIndex >= 0)
    assert.ok(geoipIndex > dedicatedPathIndex)
  })

  it('uses PROCESS-NAME rules by default when no explicit paths are passed', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['KR-VPS-TUIC'] }],
      rules: ['GEOIP,us,🚀 节点选择']
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile)

    const rules = ruleLines(profile)
    assert.ok(rules.some((rule) => rule === `DOMAIN,cursor-cdn.com,${CURSOR_DEDICATED_GROUP_NAME}`))
    for (const processName of CURSOR_PROCESS_NAMES) {
      assert.ok(rules.some((rule) => rule === `PROCESS-NAME,${processName},${CURSOR_DEDICATED_GROUP_NAME}`))
    }
    assert.ok(!rules.some((rule) => rule.includes('PROCESS-PATH-REGEX')))
  })

  it('falls back to legacy PROCESS-NAME rules when app path prefixes are empty', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['KR-VPS-TUIC'] }],
      rules: ['GEOIP,us,🚀 节点选择']
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile, [])

    const rules = ruleLines(profile)
    assert.ok(rules.some((rule) => rule === `DOMAIN,cursor-cdn.com,${CURSOR_DEDICATED_GROUP_NAME}`))
    for (const processName of CURSOR_PROCESS_NAMES) {
      assert.ok(rules.some((rule) => rule === `PROCESS-NAME,${processName},${CURSOR_DEDICATED_GROUP_NAME}`))
    }
  })

  it('skips injection when Cursor dedicated group is absent', () => {
    const profile = {
      'proxy-groups': [{ name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] }],
      rules: ['GEOIP,us,🚀 节点选择']
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile)

    assert.deepEqual(ruleLines(profile), ['GEOIP,us,🚀 节点选择'])
  })

  it('does not duplicate rules on repeated injection', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['KR-VPS-TUIC'] }],
      rules: ['GEOIP,us,🚀 节点选择']
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile, ['/Applications/Cursor-3.1.15.app'])
    const afterFirst = ruleLines(profile)
    injectCursorDomainRules(profile, ['/Applications/Cursor-3.1.15.app'])
    const afterSecond = ruleLines(profile)

    assert.deepEqual(afterSecond, afterFirst)
  })

  it('strips naked override Cursor rules and injects path-scoped gcpp domains', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['JP-VPS-Reality'] }],
      rules: [
        `DOMAIN,us-only.gcpp.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
        'GEOIP,us,🚀 节点选择'
      ]
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile, ['/Applications/Cursor-3.1.15.app'])

    const rules = ruleLines(profile)
    const pathRegex = 'PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/'
    assert.ok(
      rules.some(
        (rule) =>
          rule ===
          `AND,((DOMAIN,us-only.gcpp.cursor.sh),(${pathRegex})),${CURSOR_DEDICATED_GROUP_NAME}`
      )
    )
    assert.ok(!rules.some((rule) => rule === `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`))
    assert.ok(!rules.some((rule) => rule === `DOMAIN-SUFFIX,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`))
    assert.ok(rules.includes('GEOIP,us,🚀 节点选择'))
  })

  it('stripUnscopedCursorDedicatedRules removes legacy PROCESS-NAME dedicated rules', () => {
    const profile = {
      rules: [
        `PROCESS-NAME,Cursor,${CURSOR_DEDICATED_GROUP_NAME}`,
        `PROCESS-NAME,Cursor Helper,${CURSOR_DEDICATED_GROUP_NAME}`,
        `AND,((DOMAIN,api2.cursor.sh),(PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/)),${CURSOR_DEDICATED_GROUP_NAME}`,
        'GEOIP,us,🚀 节点选择'
      ]
    } as unknown as MihomoConfig

    stripUnscopedCursorDedicatedRules(profile)

    assert.deepEqual(ruleLines(profile), [
      `AND,((DOMAIN,api2.cursor.sh),(PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/)),${CURSOR_DEDICATED_GROUP_NAME}`,
      'GEOIP,us,🚀 节点选择'
    ])
  })

  it('migrates generateProfile legacy rules to path-scoped rules on existing profile', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['JP-VPS-HY2'] }],
      rules: [
        `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
        `PROCESS-NAME,Cursor,${CURSOR_DEDICATED_GROUP_NAME}`,
        `PROCESS-NAME,Cursor Helper,${CURSOR_DEDICATED_GROUP_NAME}`,
        `PROCESS-NAME,Cursor Helper (Renderer),${CURSOR_DEDICATED_GROUP_NAME}`,
        `PROCESS-NAME,Cursor Helper (Plugin),${CURSOR_DEDICATED_GROUP_NAME}`,
        `PROCESS-NAME,Cursor Helper (GPU),${CURSOR_DEDICATED_GROUP_NAME}`,
        'GEOIP,us,🚀 节点选择'
      ]
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile, ['/Applications/Cursor-3.1.15.app'])

    const rules = ruleLines(profile)
    const pathRegex = 'PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/'
    assert.ok(rules.some((rule) => rule.includes(pathRegex)))
    assert.ok(!rules.some((rule) => rule.startsWith('PROCESS-NAME,Cursor')))
    assert.ok(!rules.some((rule) => rule === `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`))
    assert.ok(rules.includes('GEOIP,us,🚀 节点选择'))
  })

  it('supports multiple configured Cursor app bundles', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['JP-VPS-HY2'] }],
      rules: ['MATCH,DIRECT']
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile, [
      '/Applications/Cursor-3.1.15.app',
      '/Applications/Cursor-2.app'
    ])

    const rules = ruleLines(profile)
    assert.ok(
      rules.some((rule) =>
        rule.includes('PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/')
      )
    )
    assert.ok(
      rules.some((rule) => rule.includes('PROCESS-PATH-REGEX,^/Applications/Cursor-2\\.app/'))
    )
    assert.ok(!rules.some((rule) => rule.startsWith('PROCESS-NAME,')))
  })

  it('stripUnscopedCursorDedicatedRules keeps unrelated PROCESS-NAME rules', () => {
    const profile = {
      rules: [
        'PROCESS-NAME,Arc,🚀 节点选择',
        `PROCESS-NAME,Cursor,${CURSOR_DEDICATED_GROUP_NAME}`,
        'GEOIP,us,DIRECT'
      ]
    } as unknown as MihomoConfig

    stripUnscopedCursorDedicatedRules(profile)

    assert.deepEqual(ruleLines(profile), ['PROCESS-NAME,Arc,🚀 节点选择', 'GEOIP,us,DIRECT'])
  })

  it('routes non-marathon Cursor bundles to DIRECT before subscription cursor.sh rules', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['JP-VPS-HY2'] }],
      rules: ['DOMAIN-SUFFIX,cursor.sh,🌍 国外媒体', 'GEOIP,us,DIRECT']
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile, ['/Applications/Cursor-3.1.15.app'])

    const rules = ruleLines(profile)
    const cursor2Path = 'PROCESS-PATH-REGEX,^/Applications/Cursor-2\\.app/'
    assert.ok(
      rules.some(
        (rule) =>
          rule ===
          `AND,((DOMAIN,metrics.cursor.sh),(${cursor2Path})),DIRECT`
      )
    )
    const cursorAppPath = 'PROCESS-PATH-REGEX,^/Applications/Cursor\\.app/'
    assert.ok(
      rules.some(
        (rule) =>
          rule === `AND,((DOMAIN-SUFFIX,cursor.sh),(${cursorAppPath})),DIRECT`
      )
    )

    const mediaRuleIndex = rules.indexOf('DOMAIN-SUFFIX,cursor.sh,🌍 国外媒体')
    const directCursor2Index = rules.findIndex((rule) => rule.includes(cursor2Path) && rule.endsWith(',DIRECT'))
    assert.ok(mediaRuleIndex > directCursor2Index)
  })

  it('stripUnscopedCursorDedicatedRules keeps path-scoped AND rules', () => {
    const profile = {
      rules: [
        `AND,((DOMAIN,api2.cursor.sh),(PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/)),${CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`
      ]
    } as unknown as MihomoConfig

    stripUnscopedCursorDedicatedRules(profile)

    assert.deepEqual(ruleLines(profile), [
      `AND,((DOMAIN,api2.cursor.sh),(PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/)),${CURSOR_DEDICATED_GROUP_NAME}`
    ])
  })
})
