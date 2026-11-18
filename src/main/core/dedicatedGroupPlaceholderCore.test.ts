import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { withDisabledGroupPlaceholders } from './dedicatedGroupPlaceholderCore'
import { DEDICATED_GROUPS, type DedicatedGroupId } from './dedicatedGroups'
import { ALL_GROUPS_OFF, ALL_GROUPS_ON } from './dedicatedGroupsRig'

const NONE: ReadonlySet<DedicatedGroupId> = new Set()
const pending = (...ids: DedicatedGroupId[]): ReadonlySet<DedicatedGroupId> => new Set(ids)

const group = (name: string): ControllerMixedGroup =>
  ({ name, type: 'Selector', all: ['a'], now: 'a' }) as unknown as ControllerMixedGroup

const NAME = {
  auto: '自动选择',
  cursor: '🎯 Cursor 专用',
  grok: DEDICATED_GROUPS.grok.name,
  gemini: DEDICATED_GROUPS.gemini.name,
  mail: DEDICATED_GROUPS.mail.name,
  agy: DEDICATED_GROUPS.agy.name,
  tw: 'Sparkle-台湾',
  other: '🚀 节点选择'
}

const names = (groups: ControllerMixedGroup[]): string[] => groups.map(({ name }) => name)

describe('withDisabledGroupPlaceholders', () => {
  it('leaves an empty list alone: with no groups there is nothing to anchor a placeholder to', () => {
    const live: ControllerMixedGroup[] = []

    const result = withDisabledGroupPlaceholders(live, ALL_GROUPS_OFF, NONE)

    assert.equal(result.groups, live)
    assert.equal(result.placeholderNames.size, 0)
  })

  it('returns the very same list when nothing needs a placeholder', () => {
    const live = [
      group(NAME.auto),
      group(NAME.grok),
      group(NAME.gemini),
      group(NAME.mail),
      group(NAME.agy),
      group(NAME.tw)
    ]

    const result = withDisabledGroupPlaceholders(live, ALL_GROUPS_ON, NONE)

    assert.equal(result.groups, live, 'identity is kept so memoised consumers do not recompute')
    assert.equal(result.placeholderNames.size, 0)
  })

  it('puts a disabled group back where it would have been, by display order', () => {
    const live = [
      group(NAME.auto),
      group(NAME.cursor),
      group(NAME.gemini),
      group(NAME.mail),
      group(NAME.agy),
      group(NAME.tw),
      group(NAME.other)
    ]

    const { groups, placeholderNames } = withDisabledGroupPlaceholders(live, ALL_GROUPS_OFF, NONE)

    assert.deepEqual(names(groups), [
      NAME.auto,
      NAME.cursor,
      NAME.grok,
      NAME.gemini,
      NAME.mail,
      NAME.agy,
      NAME.tw,
      NAME.other
    ])
    assert.deepEqual([...placeholderNames], [NAME.grok])
  })

  it('places several disabled groups in order, each before the first group ranked after it', () => {
    const live = [group(NAME.auto), group(NAME.cursor), group(NAME.gemini), group(NAME.tw)]

    const { groups, placeholderNames } = withDisabledGroupPlaceholders(
      live,
      { grok: false, gemini: true, mail: false, agy: false },
      NONE
    )

    assert.deepEqual(names(groups), [
      NAME.auto,
      NAME.cursor,
      NAME.grok,
      NAME.gemini,
      NAME.mail,
      NAME.agy,
      NAME.tw
    ])
    assert.deepEqual([...placeholderNames].sort(), [NAME.agy, NAME.grok, NAME.mail].sort())
  })

  it('appends to the end when every live group ranks before it', () => {
    const live = [group(NAME.auto), group(NAME.cursor)]

    const { groups } = withDisabledGroupPlaceholders(live, ALL_GROUPS_OFF, NONE)

    assert.deepEqual(names(groups), [
      NAME.auto,
      NAME.cursor,
      NAME.grok,
      NAME.gemini,
      NAME.mail,
      NAME.agy
    ])
  })

  it('keeps the built-in GLOBAL group out of the ordering, wherever the mode puts it', () => {
    const globalMode = [
      group('GLOBAL'),
      group(NAME.auto),
      group(NAME.cursor),
      group(NAME.gemini),
      group(NAME.tw)
    ]
    const ruleMode = [group(NAME.auto), group(NAME.cursor), group(NAME.tw), group('GLOBAL')]
    const grokOff = { ...ALL_GROUPS_ON, grok: false }

    assert.deepEqual(names(withDisabledGroupPlaceholders(globalMode, grokOff, NONE).groups), [
      'GLOBAL',
      NAME.auto,
      NAME.cursor,
      NAME.grok,
      NAME.gemini,
      NAME.tw
    ])
    assert.deepEqual(names(withDisabledGroupPlaceholders(ruleMode, grokOff, NONE).groups), [
      NAME.auto,
      NAME.cursor,
      NAME.grok,
      NAME.tw,
      'GLOBAL'
    ])
  })

  it('does not drift past a trailing GLOBAL when nothing ranks after the placeholder', () => {
    const live = [group(NAME.auto), group(NAME.cursor), group('GLOBAL')]

    const { groups } = withDisabledGroupPlaceholders(live, { ...ALL_GROUPS_ON, mail: false }, NONE)

    assert.deepEqual(names(groups), [NAME.auto, NAME.cursor, NAME.mail, 'GLOBAL'])
  })

  it('never stands in for a group the core really has', () => {
    const live = [group(NAME.auto), group(NAME.grok), group(NAME.tw)]

    const { groups, placeholderNames } = withDisabledGroupPlaceholders(
      live,
      { ...ALL_GROUPS_ON, grok: false },
      NONE
    )

    assert.equal(names(groups).filter((name) => name === NAME.grok).length, 1)
    assert.equal(placeholderNames.has(NAME.grok), false, 'the real one still shows its full header')
  })

  it('does not invent a placeholder for a group that is switched on but simply not live yet', () => {
    const live = [group(NAME.auto), group(NAME.tw)]

    const { groups } = withDisabledGroupPlaceholders(live, ALL_GROUPS_ON, NONE)

    assert.equal(groups, live)
  })

  it('keeps the placeholder while a switch-on is still being applied', () => {
    const live = [group(NAME.auto), group(NAME.tw)]

    const { groups, placeholderNames } = withDisabledGroupPlaceholders(
      live,
      { ...ALL_GROUPS_OFF, grok: true },
      pending('grok')
    )

    assert.ok(placeholderNames.has(NAME.grok), 'the slot stays put until the real group arrives')
    assert.deepEqual(names(groups).slice(0, 2), [NAME.auto, NAME.grok])
  })

  it('keeps showing the real group while a switch-off is still being applied', () => {
    const live = [group(NAME.auto), group(NAME.mail), group(NAME.tw)]

    const { groups, placeholderNames } = withDisabledGroupPlaceholders(
      live,
      { ...ALL_GROUPS_ON, mail: false },
      pending('mail')
    )

    assert.equal(groups, live)
    assert.equal(placeholderNames.size, 0)
  })

  it('keeps the list length steady across a whole switch-on, so index-aligned view state never shifts', () => {
    const before = [group(NAME.auto), group(NAME.cursor), group(NAME.tw)]
    const after = [group(NAME.auto), group(NAME.cursor), group(NAME.grok), group(NAME.tw)]
    const switchedOff = { ...ALL_GROUPS_ON, grok: false }
    const switchedOn = { ...ALL_GROUPS_ON, grok: true }

    const lengths = [
      withDisabledGroupPlaceholders(before, switchedOff, NONE),
      withDisabledGroupPlaceholders(before, switchedOn, pending('grok')),
      withDisabledGroupPlaceholders(after, switchedOn, pending('grok')),
      withDisabledGroupPlaceholders(after, switchedOn, NONE)
    ].map(({ groups }) => groups.length)

    assert.deepEqual(lengths, [4, 4, 4, 4])
  })

  it('builds a read-only selector placeholder without touching the input', () => {
    const live = [group(NAME.auto)]
    const snapshot = structuredClone(live)

    const { groups } = withDisabledGroupPlaceholders(live, ALL_GROUPS_OFF, NONE)
    const placeholder = groups.find(({ name }) => name === NAME.grok)

    assert.deepEqual(live, snapshot)
    assert.equal(placeholder?.type, 'Selector')
    assert.deepEqual(placeholder?.all, [])
    assert.equal(placeholder?.hidden, false)
  })
})
