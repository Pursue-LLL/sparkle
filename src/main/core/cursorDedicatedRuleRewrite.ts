// [INPUT] cursorProxyGroup::AUTO_SELECT_GROUP_NAME/CURSOR_DEDICATED_GROUP_NAME/LEGACY_CURSOR_DEDICATED_GROUP_NAMES (POS: 分组名单一出处)
// [OUTPUT] migrateLegacyCursorDedicatedGroupReferences · rewriteBroadCursorDedicatedRules
// [POS] 订阅规则里指向 Cursor 专用组的规则整理：旧组名迁到当前组名；非 Cursor 流量的规则改回自动选择。

import {
  AUTO_SELECT_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES
} from './cursorProxyGroup'

const CURSOR_RULE_HOST_MARKERS = [
  'cursor.sh',
  'cursor.com',
  'cursorapi.com',
  'cursor-cdn.com',
  'cursorapi',
  'gcpp.cursor'
] as const

function isCursorDedicatedTrafficRule(parts: string[]): boolean {
  const ruleType = parts[0]
  const payload = parts[1]?.toLowerCase() ?? ''

  if (ruleType === 'DOMAIN') {
    return CURSOR_RULE_HOST_MARKERS.some(
      (marker) => payload === marker || payload.endsWith(`.${marker}`) || payload.includes(marker)
    )
  }

  if (ruleType === 'DOMAIN-SUFFIX') {
    return CURSOR_RULE_HOST_MARKERS.some(
      (marker) => payload === marker || payload.endsWith(marker) || marker.endsWith(payload)
    )
  }

  if (ruleType === 'DOMAIN-KEYWORD') {
    return payload.includes('cursor')
  }

  return false
}

/** Rewrite rules still pointing at the pre-rename Cursor dedicated group. Returns true if any rule changed. */
export function migrateLegacyCursorDedicatedGroupReferences(profile: MihomoConfig): boolean {
  const rules = profile.rules as string[] | undefined
  if (!rules?.length) {
    return false
  }
  let migrated = false
  profile.rules = rules.map((rule) => {
    let nextRule = rule
    let ruleMigrated = false
    for (const legacyName of LEGACY_CURSOR_DEDICATED_GROUP_NAMES) {
      if (!nextRule.includes(legacyName)) {
        continue
      }
      ruleMigrated = true
      nextRule = nextRule.split(legacyName).join(CURSOR_DEDICATED_GROUP_NAME)
    }
    if (ruleMigrated) {
      migrated = true
    }
    return nextRule
  }) as MihomoConfig['rules']
  return migrated
}

/** Rewrite non-Cursor subscription rules that hijack general traffic into Cursor 专用. */
export function rewriteBroadCursorDedicatedRules(profile: MihomoConfig): void {
  const rules = profile.rules as string[] | undefined
  if (!rules?.length) {
    return
  }

  profile.rules = rules.map((rule) => {
    const trimmed = rule.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return rule
    }
    const parts = trimmed.split(',').map((part) => part.trim())
    if (parts.length < 3) {
      return rule
    }
    const policy = parts[parts.length - 1]
    if (policy !== CURSOR_DEDICATED_GROUP_NAME) {
      return rule
    }
    if (isCursorDedicatedTrafficRule(parts)) {
      return rule
    }
    parts[parts.length - 1] = AUTO_SELECT_GROUP_NAME
    return parts.join(',')
  }) as MihomoConfig['rules']
}
