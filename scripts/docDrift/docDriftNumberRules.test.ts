// [INPUT] docDriftNumberRules::numericConstants/collectConstants/numberClaims/checkDocNumbers (POS: 文档漂移守护的数值规则，只判定数值与常量名挂在一起的写法) ·
//         docDriftRig::snapshotOf/findingsOf/rulesOf (POS: 文档漂移守护各测试共用的夹具，用几行字符串拼内存快照)
// [OUTPUT] （无导出，仅测试）
// [POS] 数值规则的正反例：常量求值（字面量、下划线、四则、引用前面的常量）、文档里「常量名（数值）」与「常量名 = 数值」
//       两种写法的单位换算与比对，以及哪些情况不判定（同名不同值、求不出值、散文里没挂常量名的数字）。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  checkDocNumbers,
  collectConstants,
  numberClaims,
  numericConstants
} from './docDriftNumberRules'
import { findingsOf, rulesOf, snapshotOf } from './docDriftRig'

const lines = (...rows: string[]): string => rows.join('\n')

describe('numericConstants', () => {
  it('evaluates literals, separators, arithmetic and references to earlier constants', () => {
    const values = numericConstants(
      lines(
        'export const AGY_PIN_CHECK_INTERVAL_MS = 30 * 60_000',
        'const AGY_PIN_UNKNOWN_STREAK_LIMIT: number = 2',
        'const TOTAL_MS = AGY_PIN_CHECK_INTERVAL_MS * AGY_PIN_UNKNOWN_STREAK_LIMIT // 两轮',
        'const HOUR_MS = (60 + 0) * 60 * 1000 as const',
        'const QUARTER = 1_000 / 4',
        'const NEGATIVE = -5',
        'const RATE = 1.5'
      )
    )
    assert.deepEqual(Object.fromEntries(values), {
      AGY_PIN_CHECK_INTERVAL_MS: 1_800_000,
      AGY_PIN_UNKNOWN_STREAK_LIMIT: 2,
      TOTAL_MS: 3_600_000,
      HOUR_MS: 3_600_000,
      QUARTER: 250,
      NEGATIVE: -5,
      RATE: 1.5
    })
  })

  it('skips what it cannot evaluate: strings, calls, forward references, lowercase names', () => {
    const values = numericConstants(
      lines(
        "const NOT_NUMERIC = 'x'",
        'const CALLED = compute(3)',
        'const FORWARD = LATER + 1',
        'const LATER = 5',
        'const lowerCase = 3',
        'const DIVIDED = 1 / 0',
        'const UNBALANCED = (1 + 2'
      )
    )
    assert.deepEqual(Object.fromEntries(values), { LATER: 5 })
  })
})

describe('collectConstants', () => {
  it('keeps a shared value and marks a same-name constant with different values as ambiguous', () => {
    const constants = collectConstants(
      new Map([
        ['src/a.ts', 'export const SAME_MS = 5\nexport const CLASH_MS = 1\n'],
        ['src/b.ts', 'const SAME_MS = 5\nconst CLASH_MS = 2\nconst ONLY_B = 7\n']
      ])
    )
    assert.deepEqual(Object.fromEntries(constants), { SAME_MS: 5, CLASH_MS: null, ONLY_B: 7 })
  })
})

describe('numberClaims', () => {
  const constants = new Map<string, number | null>([
    ['AGY_PIN_CHECK_INTERVAL_MS', 1_800_000],
    ['AGY_PIN_UNKNOWN_STREAK_LIMIT', 2],
    ['AGY_CLASH_MS', null],
    ['HALF_SECOND_MS', 500]
  ])
  const claimsOf = (doc: string): Array<[string, number, number]> =>
    numberClaims(new Map([['ARCHITECTURE.md', doc]]), constants).map((claim) => [
      claim.name,
      claim.actual,
      claim.claimed
    ])

  it('reads `name（value）` and `name = value` for duration constants, in any unit', () => {
    assert.deepEqual(
      claimsOf(
        lines(
          '`AGY_PIN_CHECK_INTERVAL_MS`（30 分钟）',
          '`AGY_PIN_CHECK_INTERVAL_MS`(1800 s)',
          '`AGY_PIN_CHECK_INTERVAL_MS` = 30min',
          '`AGY_PIN_CHECK_INTERVAL_MS`（现为 0.5 小时 × 2）',
          '`HALF_SECOND_MS`（0.5 秒）'
        )
      ),
      [
        ['AGY_PIN_CHECK_INTERVAL_MS', 1_800_000, 1_800_000],
        ['AGY_PIN_CHECK_INTERVAL_MS', 1_800_000, 1_800_000],
        ['AGY_PIN_CHECK_INTERVAL_MS', 1_800_000, 1_800_000],
        ['AGY_PIN_CHECK_INTERVAL_MS', 1_800_000, 1_800_000],
        ['HALF_SECOND_MS', 500, 500]
      ]
    )
  })

  it('reads a bare count for non-time constants, and only a bare count', () => {
    assert.deepEqual(
      claimsOf(
        lines(
          '`AGY_PIN_UNKNOWN_STREAK_LIMIT`（2）',
          '`AGY_PIN_UNKNOWN_STREAK_LIMIT`（默认 2）',
          '`AGY_PIN_UNKNOWN_STREAK_LIMIT`（3 次）',
          '`AGY_PIN_UNKNOWN_STREAK_LIMIT` = 3',
          '`AGY_PIN_UNKNOWN_STREAK_LIMIT`（2 条规则）',
          '`AGY_PIN_UNKNOWN_STREAK_LIMIT`（连续 2 次）'
        )
      ),
      [
        ['AGY_PIN_UNKNOWN_STREAK_LIMIT', 2, 2],
        ['AGY_PIN_UNKNOWN_STREAK_LIMIT', 2, 2],
        ['AGY_PIN_UNKNOWN_STREAK_LIMIT', 2, 3],
        ['AGY_PIN_UNKNOWN_STREAK_LIMIT', 2, 3]
      ]
    )
  })

  it('does not bind numbers that are not attached to a known, unambiguous constant', () => {
    assert.deepEqual(
      claimsOf(
        lines(
          '`AGY_CLASH_MS`（10 分钟）',
          '`AGY_UNKNOWN_MS`（10 分钟）',
          '`AGY_PIN_CHECK_INTERVAL_MS` 每轮都会跑，约 10 分钟一次',
          '`AGY_PIN_CHECK_INTERVAL_MS`（见下表）',
          '```',
          '`AGY_PIN_CHECK_INTERVAL_MS`（10 分钟）',
          '```'
        )
      ),
      []
    )
  })
})

describe('checkDocNumbers', () => {
  const constants = new Map<string, number | null>([
    ['AGY_PIN_CHECK_INTERVAL_MS', 1_800_000],
    ['AGY_PIN_UNKNOWN_STREAK_LIMIT', 2],
    ['SHORT_MS', 90_000],
    ['TINY_MS', 1500]
  ])
  const messagesOf = (doc: string): string[] =>
    checkDocNumbers(new Map([['ARCHITECTURE.md', doc]]), constants).map(
      (finding) => `${finding.line}:${finding.message}`
    )

  it('passes when the documented numbers equal the code', () => {
    assert.deepEqual(
      messagesOf('`AGY_PIN_CHECK_INTERVAL_MS`（30 分钟） · `AGY_PIN_UNKNOWN_STREAK_LIMIT`（2）'),
      []
    )
  })

  it('reports the code value in the most natural unit next to what the doc says', () => {
    assert.deepEqual(
      messagesOf(
        lines(
          '`AGY_PIN_CHECK_INTERVAL_MS`（10 分钟）',
          '`AGY_PIN_UNKNOWN_STREAK_LIMIT`（3）',
          '`SHORT_MS`（2 分钟）',
          '`TINY_MS`（2 秒）'
        )
      ),
      [
        '1:AGY_PIN_CHECK_INTERVAL_MS 在代码里是 30 分钟，文档写的是 10 分钟',
        '2:AGY_PIN_UNKNOWN_STREAK_LIMIT 在代码里是 2，文档写的是 3',
        '3:SHORT_MS 在代码里是 90 秒，文档写的是 2 分钟',
        '4:TINY_MS 在代码里是 1500 毫秒，文档写的是 2 秒'
      ]
    )
  })

  it('is wired into the whole check: a changed constant surfaces as a mismatch', () => {
    const docs = { 'ARCHITECTURE.md': '`AGY_PIN_CHECK_INTERVAL_MS`（10 分钟）' }
    const code = (expression: string): Record<string, string> => ({
      'src/a.ts': `export const AGY_PIN_CHECK_INTERVAL_MS = ${expression}\n`
    })
    assert.deepEqual(findingsOf(snapshotOf({ sources: code('10 * 60_000'), docs })), [])
    assert.deepEqual(findingsOf(snapshotOf({ sources: code('30 * 60_000'), docs })), [
      'ARCHITECTURE.md:1 [doc-number-mismatch] AGY_PIN_CHECK_INTERVAL_MS 在代码里是 30 分钟，文档写的是 10 分钟'
    ])
  })

  it('does not take a constant that only the guard samples declare', () => {
    const snapshot = snapshotOf({
      sources: { 'scripts/docDrift/sample.test.ts': 'export const CLAIMED_MS = 5\n' },
      docs: { 'ARCHITECTURE.md': '`CLAIMED_MS`（10 分钟）' }
    })
    assert.deepEqual(rulesOf(snapshot), ['doc-identifier-missing'])
  })
})
