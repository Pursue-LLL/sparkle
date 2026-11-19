import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGY_EVIDENCE_ACTIVITY_MS,
  AGY_EVIDENCE_GRACE_MS,
  AGY_EVIDENCE_MIN_TENURE_MS,
  AGY_EVIDENCE_REJECTION_THRESHOLD,
  AGY_EVIDENCE_WINDOW_MS,
  extractAgyRejections,
  judgeAgyPinByProduction,
  parseAgyLogFilePaths,
  type AgyRejections
} from './sparkleAgyEvidenceCore'
import {
  benignAicodeTimeoutRecord,
  fetchConfigRejectionRecord,
  fetchLicensesRejectionRecord,
  generationRejectionRecord,
  glogStamp
} from './sparkleAgyEvidenceFixtures'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
/** glog 的时间戳用本地时间且没有年份，夹具按同样的方式构造。 */
const at = (month: number, day: number, hour: number, minute: number, second = 0): number =>
  new Date(2026, month - 1, day, hour, minute, second).getTime()
const NOW = at(11, 18, 21, 30)

const none = (): AgyRejections => ({ generation: [], aicode: [] })

describe('extractAgyRejections', () => {
  it('counts a generation rejection at its own timestamp', () => {
    const when = at(11, 18, 21, 8, 28)

    assert.deepEqual(extractAgyRejections(generationRejectionRecord(when), NOW), {
      generation: [when],
      aicode: []
    })
  })

  it('counts an aicode rejection that sits on one long line', () => {
    const when = at(11, 18, 21, 13, 44)

    assert.deepEqual(extractAgyRejections(fetchConfigRejectionRecord(when), NOW), {
      generation: [],
      aicode: [when]
    })
  })

  it('attributes a marker on a continuation line to the header of its record, once', () => {
    const when = at(11, 18, 21, 13, 44)
    const text = `${fetchLicensesRejectionRecord(when)}\n    "reason": "LOCATION_NOT_ELIGIBLE"\nI${glogStamp(when + SECOND_MS)}   1 other.go:1] unrelated`

    assert.deepEqual(extractAgyRejections(text, NOW), { generation: [], aicode: [when] })
  })

  it('counts separate records of the same second separately', () => {
    const when = at(11, 18, 21, 13, 44)
    const text = [
      fetchConfigRejectionRecord(when),
      fetchLicensesRejectionRecord(when),
      generationRejectionRecord(when)
    ].join('\n')

    const found = extractAgyRejections(text, NOW)

    assert.deepEqual(found, { generation: [when], aicode: [when, when] })
  })

  it('ignores records that only look similar', () => {
    const when = at(11, 18, 21, 13, 44)
    const text = [
      benignAicodeTimeoutRecord(when),
      `E${glogStamp(when)}      71 errorreport.go:307] Failed to poll ListExperiments: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:listExperiments": EOF`,
      // 同样的文字出现在非错误记录里（例如被贴进对话）：没有 gRPC 状态名，不是服务端的拒绝。
      `I${glogStamp(when)}      88 chat.go:12] user said: User location is not supported for the API use.`
    ].join('\n')

    assert.deepEqual(extractAgyRejections(text, NOW), none())
  })

  it('ignores continuation lines that precede the first header', () => {
    const text = `    "reason": "LOCATION_NOT_ELIGIBLE"\n${generationRejectionRecord(at(11, 18, 21, 8, 28))}`

    const found = extractAgyRejections(text, NOW)

    assert.deepEqual(found.aicode, [])
    assert.equal(found.generation.length, 1)
  })

  it('reads records written around New Year as belonging to last year', () => {
    const now = new Date(2027, 0, 1, 0, 10, 0).getTime()
    const decemberRecord = new Date(2026, 11, 31, 23, 58, 0).getTime()
    const januaryRecord = new Date(2027, 0, 1, 0, 5, 0).getTime()
    const text = [
      generationRejectionRecord(decemberRecord),
      generationRejectionRecord(januaryRecord)
    ].join('\n')

    assert.deepEqual(extractAgyRejections(text, now).generation, [decemberRecord, januaryRecord])
  })

  it('skips headers whose date is impossible', () => {
    const text =
      'E1340 21:08:28.123456 1 errorreport.go:307] FAILED_PRECONDITION: location is not supported'

    assert.deepEqual(extractAgyRejections(text, NOW), none())
  })

  it('returns nothing for empty text', () => {
    assert.deepEqual(extractAgyRejections('', NOW), none())
  })
})

describe('parseAgyLogFilePaths', () => {
  const PS = [
    '/sbin/launchd',
    '/Users/me/.local/bin/agy',
    '/Users/me/.local/bin/agy --log-file /Users/me/.cache/agy-tools/launch-logs/session-1.log',
    'agy --gemini_dir /tmp/x --log-file /tmp/probe-1.log --print Reply',
    '/Users/me/.local/bin/agy --log-file=/tmp/equals.log --model m',
    '/Users/me/.local/bin/agy --log-file /Users/me/.cache/agy-tools/launch-logs/session-1.log',
    '/Applications/Agy 管家.app/Contents/MacOS/agy-manager --log-file /tmp/not-agy.log',
    'Python /Applications/Agy 管家.app/Contents/Resources/core/bin/agy-core launch --log-file /tmp/core.log',
    'caffeinate -i /Users/me/.local/bin/agy --log-file /tmp/wrapped.log'
  ].join('\n')

  it('returns the log files named by running agy processes, once each', () => {
    assert.deepEqual(parseAgyLogFilePaths(PS), [
      '/Users/me/.cache/agy-tools/launch-logs/session-1.log',
      '/tmp/probe-1.log',
      '/tmp/equals.log',
      '/tmp/wrapped.log'
    ])
  })

  it('returns nothing when no agy process names a log file', () => {
    assert.deepEqual(parseAgyLogFilePaths('/sbin/launchd\n/Users/me/.local/bin/agy\n'), [])
    assert.deepEqual(parseAgyLogFilePaths(''), [])
  })
})

describe('judgeAgyPinByProduction', () => {
  const PIN_SINCE = NOW - 60 * MINUTE_MS
  const recent = (ageMs: number): number => NOW - ageMs
  const judge = (
    rejections: Partial<AgyRejections>,
    options: { lastActivityMs?: number | null; pinSinceMs?: number; nowMs?: number } = {}
  ) =>
    judgeAgyPinByProduction({
      rejections: { ...none(), ...rejections },
      lastActivityMs:
        options.lastActivityMs === undefined ? NOW - MINUTE_MS : options.lastActivityMs,
      nowMs: options.nowMs ?? NOW,
      pinSinceMs: options.pinSinceMs ?? PIN_SINCE
    })

  it('rejects the pin once the threshold of records is reached inside the window', () => {
    const records = [recent(5 * MINUTE_MS), recent(3 * MINUTE_MS), recent(MINUTE_MS)]

    assert.deepEqual(judge({ aicode: records }), { verdict: 'rejected', records: 3 })
    assert.equal(AGY_EVIDENCE_REJECTION_THRESHOLD, 3)
  })

  it('adds generation and aicode records together', () => {
    const result = judge({
      generation: [recent(2 * MINUTE_MS)],
      aicode: [recent(MINUTE_MS), recent(MINUTE_MS)]
    })

    assert.deepEqual(result, { verdict: 'rejected', records: 3 })
  })

  it('does not reject on fewer records than the threshold, and is not healthy either', () => {
    const result = judge({ aicode: [recent(2 * MINUTE_MS), recent(MINUTE_MS)] })

    assert.deepEqual(result, { verdict: 'unobserved', records: 2 })
  })

  it('counts a record exactly at the window edge and drops one just outside', () => {
    const edge = recent(AGY_EVIDENCE_WINDOW_MS)

    assert.equal(judge({ aicode: [edge, edge, edge] }).verdict, 'rejected')
    assert.equal(judge({ aicode: [edge - 1, edge - 1, edge - 1] }).verdict, 'healthy')
  })

  it('ignores records written during the grace period after the pin took over', () => {
    const pinSinceMs = NOW - 5 * MINUTE_MS
    const early = pinSinceMs + AGY_EVIDENCE_GRACE_MS - 1
    const settled = pinSinceMs + AGY_EVIDENCE_GRACE_MS

    assert.equal(judge({ aicode: [early, early, early] }, { pinSinceMs }).records, 0)
    assert.equal(judge({ aicode: [settled, settled, settled] }, { pinSinceMs }).verdict, 'rejected')
  })

  it('tolerates a little clock skew but not records from the future', () => {
    const skewed = NOW + 30 * SECOND_MS
    const future = NOW + 61 * SECOND_MS

    assert.equal(judge({ aicode: [skewed, skewed, skewed] }).verdict, 'rejected')
    assert.equal(judge({ aicode: [future, future, future] }).records, 0)
  })

  it('judges the pin healthy when sessions have been active and nothing was rejected', () => {
    assert.deepEqual(judge({}), { verdict: 'healthy', records: 0 })
  })

  it('does not call a pin healthy before it has been in place long enough', () => {
    const justEnough = NOW - AGY_EVIDENCE_MIN_TENURE_MS
    const tooShort = justEnough + 1

    assert.equal(judge({}, { pinSinceMs: justEnough }).verdict, 'healthy')
    assert.equal(judge({}, { pinSinceMs: tooShort }).verdict, 'unobserved')
  })

  it('does not call a pin healthy without recent session activity', () => {
    const stale = NOW - AGY_EVIDENCE_ACTIVITY_MS - 1

    assert.equal(judge({}, { lastActivityMs: NOW - AGY_EVIDENCE_ACTIVITY_MS }).verdict, 'healthy')
    assert.equal(judge({}, { lastActivityMs: stale }).verdict, 'unobserved')
    assert.equal(judge({}, { lastActivityMs: null }).verdict, 'unobserved')
  })

  it('does not count activity that happened before the pin took over', () => {
    const pinSinceMs = NOW - AGY_EVIDENCE_MIN_TENURE_MS
    const beforePin = pinSinceMs + AGY_EVIDENCE_GRACE_MS - 1
    const afterGrace = pinSinceMs + AGY_EVIDENCE_GRACE_MS

    assert.equal(judge({}, { pinSinceMs, lastActivityMs: beforePin }).verdict, 'unobserved')
    assert.equal(judge({}, { pinSinceMs, lastActivityMs: afterGrace }).verdict, 'healthy')
  })

  it('rejects on the records alone, whether or not sessions look active', () => {
    const records = [recent(MINUTE_MS), recent(MINUTE_MS), recent(MINUTE_MS)]

    assert.equal(judge({ aicode: records }, { lastActivityMs: null }).verdict, 'rejected')
  })
})
