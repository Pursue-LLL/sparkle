import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_DEDICATED_GROUP_NAME,
  GENERAL_PROXY_GROUP_NAME,
  resolveCursorStableSelectorGroup,
  resolveGeneralProxySelectGroup
} from './cursorProxyGroup'
import { CURSOR_2_APP_PATH_PREFIX } from './cursorAppBundlePathsCore'
import {
  injectCursorDomainRules,
  stripUnscopedCursorDedicatedRules
} from './cursorRuleInjection'

function ruleLines(profile: MihomoConfig): string[] {
  return ((profile.rules as string[] | undefined) ?? []).map((rule) => rule.trim())
}

function profileWithCursorGroups(
  dedicatedProxies: string[] = ['KR-VPS-TUIC']
): MihomoConfig {
  return {
    'proxy-groups': [
      { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: dedicatedProxies },
      { name: GENERAL_PROXY_GROUP_NAME, type: 'select', proxies: ['SG-01'] }
    ],
    rules: ['GEOIP,us,🚀 节点选择', 'MATCH,DIRECT']
  } as unknown as MihomoConfig
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

describe('resolveGeneralProxySelectGroup', () => {
  it('finds 🚀 节点选择 select group', () => {
    const group = resolveGeneralProxySelectGroup([
      { name: GENERAL_PROXY_GROUP_NAME, type: 'select', proxies: ['SG-01'] }
    ] as unknown as ControllerMixedGroup[])
    assert.equal(group?.name, GENERAL_PROXY_GROUP_NAME)
  })

  it('falls back to 自动选择 alias when 🚀 节点选择 is missing', () => {
    const group = resolveGeneralProxySelectGroup([
      { name: '自动选择', type: 'select', proxies: ['SG-01'] }
    ] as unknown as ControllerMixedGroup[])
    assert.equal(group?.name, '自动选择')
  })
})

describe('injectCursorDomainRules', () => {
  it('defaults all three Cursor installs to 🎯 Cursor 专用', () => {
    const profile = profileWithCursorGroups()
    injectCursorDomainRules(profile)

    const rules = ruleLines(profile)
    const cursor2Regex = 'PROCESS-PATH-REGEX,^/Applications/Cursor-2\\.app/'
    const cursorMainRegex = 'PROCESS-PATH-REGEX,^/Applications/Cursor\\.app/'
    const cursor315Regex = 'PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/'

    assert.ok(
      rules.some(
        (rule) =>
          rule ===
          `AND,((DOMAIN,cursor-cdn.com),(${cursor2Regex})),${CURSOR_DEDICATED_GROUP_NAME}`
      )
    )
    assert.ok(
      rules.some((rule) => rule === `${cursorMainRegex},${CURSOR_DEDICATED_GROUP_NAME}`)
    )
    assert.ok(
      rules.some(
        (rule) =>
          rule === `AND,((DOMAIN-SUFFIX,cursor.sh),(${cursor315Regex})),${CURSOR_DEDICATED_GROUP_NAME}`
      )
    )
    assert.ok(!rules.some((rule) => rule.startsWith('PROCESS-NAME,')))
    assert.ok(
      !rules.some((rule) => rule === `DOMAIN,cursor-cdn.com,${GENERAL_PROXY_GROUP_NAME}`)
    )

    const geoipIndex = rules.indexOf('GEOIP,us,🚀 节点选择')
    const dedicatedPathIndex = rules.findIndex(
      (rule) => rule === `${cursorMainRegex},${CURSOR_DEDICATED_GROUP_NAME}`
    )
    assert.ok(dedicatedPathIndex >= 0)
    assert.ok(geoipIndex > dedicatedPathIndex)
  })

  it('falls back to default dedicated prefixes when explicit dedicated prefixes are empty', () => {
    const profile = profileWithCursorGroups()
    injectCursorDomainRules(profile, [])

    const rules = ruleLines(profile)
    assert.ok(
      rules.some((rule) =>
        rule.includes('PROCESS-PATH-REGEX,^/Applications/Cursor-2\\.app/') &&
        rule.endsWith(`,${CURSOR_DEDICATED_GROUP_NAME}`)
      )
    )
    assert.ok(
      rules.some(
        (rule) =>
          rule.includes('PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/') &&
          rule.endsWith(`,${CURSOR_DEDICATED_GROUP_NAME}`)
      )
    )
    assert.ok(!rules.some((rule) => rule.startsWith('PROCESS-NAME,')))
  })

  it('injects dedicated rules when only 🎯 Cursor 专用 exists', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['SG-01'] }],
      rules: ['GEOIP,us,DIRECT']
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile)

    const rules = ruleLines(profile)
    assert.ok(
      rules.some(
        (rule) =>
          rule.includes('PROCESS-PATH-REGEX,^/Applications/Cursor\\.app/') &&
          rule.endsWith(`,${CURSOR_DEDICATED_GROUP_NAME}`)
      )
    )
    assert.ok(rules.includes('GEOIP,us,DIRECT'))
  })

  it('skips injection when no dedicated or node-select group exists', () => {
    const profile = {
      'proxy-groups': [{ name: '自定义组', type: 'select', proxies: ['SG-01'] }],
      rules: ['GEOIP,us,DIRECT']
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile)

    const rules = ruleLines(profile)
    assert.ok(
      !rules.some(
        (rule) =>
          rule.includes('PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/') ||
          rule.includes('PROCESS-PATH-REGEX,^/Applications/Cursor\\.app/') ||
          rule.includes('PROCESS-PATH-REGEX,^/Applications/Cursor-2\\.app/')
      )
    )
    assert.ok(rules.includes('GEOIP,us,DIRECT'))
  })

  it('does not duplicate rules on repeated injection', () => {
    const profile = profileWithCursorGroups()
    injectCursorDomainRules(profile, [])
    const afterFirst = ruleLines(profile)
    injectCursorDomainRules(profile, [])
    assert.deepEqual(ruleLines(profile), afterFirst)
  })

  it('removes subscription PROCESS-NAME Cursor rules when path prefixes are configured', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['JP-VPS-Reality'] },
        { name: GENERAL_PROXY_GROUP_NAME, type: 'select', proxies: ['SG-01'] }
      ],
      rules: [
        `DOMAIN,us-only.gcpp.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
        `PROCESS-NAME,Cursor,${CURSOR_DEDICATED_GROUP_NAME}`,
        `PROCESS-NAME,Cursor Helper,${CURSOR_DEDICATED_GROUP_NAME}`,
        `AND,((DOMAIN,api2.cursor.sh),(PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/)),${CURSOR_DEDICATED_GROUP_NAME}`,
        'GEOIP,us,🚀 节点选择'
      ]
    } as unknown as MihomoConfig

    injectCursorDomainRules(profile, [CURSOR_2_APP_PATH_PREFIX])

    const rules = ruleLines(profile)
    const cursor2Regex = 'PROCESS-PATH-REGEX,^/Applications/Cursor-2\\.app/'
    assert.ok(
      rules.some(
        (rule) =>
          rule.includes(cursor2Regex) && rule.endsWith(`,${CURSOR_DEDICATED_GROUP_NAME}`)
      )
    )
    assert.ok(!rules.some((rule) => rule.startsWith('PROCESS-NAME,Cursor')))
    assert.ok(!rules.some((rule) => rule === `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`))
    assert.ok(rules.includes('GEOIP,us,🚀 节点选择'))
  })

  it('routes stock Cursor.app, Cursor-2, and Cursor-3.1.15 to Cursor 专用', () => {
    const profile = profileWithCursorGroups(['JP-VPS-HY2'])
    profile.rules = ['DOMAIN-SUFFIX,cursor.sh,🌍 国外媒体', 'GEOIP,us,DIRECT']

    injectCursorDomainRules(profile, [])

    const rules = ruleLines(profile)
    const cursorAppPath = 'PROCESS-PATH-REGEX,^/Applications/Cursor\\.app/'
    const cursor315Path = 'PROCESS-PATH-REGEX,^/Applications/Cursor-3\\.1\\.15\\.app/'
    assert.ok(
      rules.some(
        (rule) =>
          rule === `AND,((DOMAIN-SUFFIX,cursor.sh),(${cursorAppPath})),${CURSOR_DEDICATED_GROUP_NAME}`
      )
    )
    assert.ok(
      rules.some(
        (rule) =>
          rule === `AND,((DOMAIN-SUFFIX,cursor.sh),(${cursor315Path})),${CURSOR_DEDICATED_GROUP_NAME}`
      )
    )
    assert.ok(
      rules.some(
        (rule) =>
          rule.includes('PROCESS-PATH-REGEX,^/Applications/Cursor-2\\.app/') &&
          rule.endsWith(`,${CURSOR_DEDICATED_GROUP_NAME}`)
      )
    )

    const mediaRuleIndex = rules.indexOf('DOMAIN-SUFFIX,cursor.sh,🌍 国外媒体')
    const dedicatedCursorAppIndex = rules.findIndex(
      (rule) =>
        rule.includes(cursorAppPath) && rule.endsWith(`,${CURSOR_DEDICATED_GROUP_NAME}`)
    )
    assert.ok(mediaRuleIndex > dedicatedCursorAppIndex)
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

  it('stripUnscopedCursorDedicatedRules keeps path-scoped AND rules', () => {
    const profile = {
      rules: [
        `AND,((DOMAIN,api2.cursor.sh),(PROCESS-PATH-REGEX,^/Applications/Cursor-2\\.app/)),${CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`
      ]
    } as unknown as MihomoConfig

    stripUnscopedCursorDedicatedRules(profile)

    assert.deepEqual(ruleLines(profile), [
      `AND,((DOMAIN,api2.cursor.sh),(PROCESS-PATH-REGEX,^/Applications/Cursor-2\\.app/)),${CURSOR_DEDICATED_GROUP_NAME}`
    ])
  })
})
