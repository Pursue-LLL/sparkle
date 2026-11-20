import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GATE_OPEN } from './dedicatedGroupsRig'
import {
  advance,
  headOn,
  inUse,
  logLine,
  MINUTE_MS,
  restrictNodes,
  tick,
  TICK_MS
} from './sparkleGeminiGuardHarness'
import { writeCache } from './sparkleGeminiFilesHarness'
import {
  cacheKey,
  cacheRecord,
  callsStarting,
  guard,
  NODES,
  useGeminiRig,
  world
} from './sparkleGeminiProbeRig'
import { spyOnTimer } from './timerSpyHarness'

const JP1 = NODES[2]
const SESSION_START_DELAY_MS = 15 * 1000
const GEMINI_LINE =
  '[TCP] 198.18.0.1:59676(Browser Helper (Aperitif)) --> gemini.google.com:443 match DomainSuffix(gemini.google.com) using gemini专用[日本-1]'
const FAILED_DIAL =
  '[TCP] dial gemini专用 (match DomainSuffix/gemini.google.com) 127.0.0.1:62817(curl) --> gemini.google.com:443 error: i/o timeout'

/** 日本-1 已有一条这么旧的合格判定。 */
const verdictAged = (ageMs: number): void =>
  writeCache({ [cacheKey(JP1)]: cacheRecord(true, 'JP', ageMs) })

const probes = (): string[] => callsStarting('lock:')

/** 队首是日本-1，Google 对所有节点都给出合格结论。 */
function armed(): void {
  headOn('日本-1')
  restrictNodes()
  guard().startSparkleGeminiCurrentNodeGuardLoop(GATE_OPEN)
}

describe('sparkleGeminiCurrentNodeGuard loop', () => {
  useGeminiRig()

  it('listens to the core logs once however often it is started', () => {
    guard().startSparkleGeminiCurrentNodeGuardLoop(GATE_OPEN)
    guard().startSparkleGeminiCurrentNodeGuardLoop(GATE_OPEN)

    assert.equal(world.subscriptions, 1)
  })

  it('registers one five-minute timer that does not keep the process alive', () => {
    const timers = spyOnTimer('setInterval')
    try {
      guard().startSparkleGeminiCurrentNodeGuardLoop(GATE_OPEN)
      guard().startSparkleGeminiCurrentNodeGuardLoop(GATE_OPEN)

      assert.deepEqual(timers.delays, [TICK_MS])
      assert.equal(timers.unrefs(), 1)
    } finally {
      timers.restore()
    }
  })

  it('first checks after exactly five minutes', async () => {
    armed()

    await advance(TICK_MS - 1)
    assert.deepEqual(callsStarting('detail:'), [])

    await advance(1)
    assert.deepEqual(callsStarting('detail:'), ['detail:gemini专用'])
  })
})

describe('sparkleGeminiCurrentNodeGuard how old a verdict may be', () => {
  useGeminiRig()

  it('verifies a head that has no verdict yet at the first tick', async () => {
    armed()

    await tick()

    assert.deepEqual(probes(), ['lock:日本-1'])
  })

  it('leaves a fresh verdict alone while idle and re-verifies it once it is 25 minutes old', async () => {
    verdictAged(0)
    armed()

    for (let round = 0; round < 4; round++) {
      await tick()
    }
    assert.deepEqual(probes(), [], 'twenty minutes in, the verdict is still fresh')

    await tick()
    assert.deepEqual(probes(), ['lock:日本-1'])
  })

  it('re-verifies on every tick while a connection runs through the group', async () => {
    verdictAged(0)
    inUse()
    armed()

    await tick()
    await tick()

    assert.equal(probes().length, 2)
  })

  it('treats the group as in use for ten minutes after its last connection', async () => {
    inUse()
    armed()
    await tick()
    world.connections = undefined

    await tick()
    assert.equal(probes().length, 2, 'five minutes after the last connection it is still in use')

    await tick()
    assert.equal(probes().length, 2, 'ten minutes after, a five-minute-old verdict is fine')
  })

  it('carries on as if the group were idle when the connection data is unreachable', async () => {
    verdictAged(0)
    inUse()
    world.connectionsFailure = true
    armed()

    await tick()

    assert.deepEqual(probes(), [])
    assert.deepEqual(world.logs, [])
  })
})

describe('sparkleGeminiCurrentNodeGuard new session', () => {
  useGeminiRig()

  it('verifies the head fifteen seconds after the first connection of a session', async () => {
    verdictAged(10 * MINUTE_MS)
    armed()
    logLine(GEMINI_LINE)

    await advance(SESSION_START_DELAY_MS - 1)
    assert.deepEqual(probes(), [])

    await advance(1)
    assert.deepEqual(probes(), ['lock:日本-1'])
  })

  it('also starts a session on a failed dial', async () => {
    verdictAged(10 * MINUTE_MS)
    armed()
    logLine(FAILED_DIAL)

    await advance(SESSION_START_DELAY_MS)

    assert.deepEqual(probes(), ['lock:日本-1'])
  })

  it('does not re-probe a verdict younger than three minutes', async () => {
    verdictAged(MINUTE_MS)
    armed()
    logLine(GEMINI_LINE)

    await advance(SESSION_START_DELAY_MS)

    assert.deepEqual(probes(), [])
  })

  it('ignores lines that are not Gemini being used', async () => {
    verdictAged(10 * MINUTE_MS)
    armed()
    for (const payload of [
      'Start initial provider gemini专用',
      "[Provider] gemini专用's content update",
      '[TCP] x --> github.com:443 match using 自动选择[日本-1]',
      '[TCP] 127.0.0.1:58300 --> gemini.google.com:443 using __sparkle_mail_probe__[日本-1]',
      undefined
    ]) {
      logLine(payload)
    }

    await advance(SESSION_START_DELAY_MS)

    assert.deepEqual(world.calls, [])
  })

  it('schedules one early check per session, and a new one once the session went quiet', async () => {
    armed()
    const timers = spyOnTimer('setTimeout')
    try {
      logLine(GEMINI_LINE)
      logLine(GEMINI_LINE)
      assert.deepEqual(timers.delays, [SESSION_START_DELAY_MS])
      assert.equal(timers.unrefs(), 1)

      await advance(SESSION_START_DELAY_MS)
      logLine(GEMINI_LINE)
      assert.deepEqual(timers.delays, [SESSION_START_DELAY_MS], 'still the same session')

      await advance(10 * MINUTE_MS)
      logLine(GEMINI_LINE)
      assert.deepEqual(timers.delays, [SESSION_START_DELAY_MS, SESSION_START_DELAY_MS])
    } finally {
      timers.restore()
    }
  })
})

describe('sparkleGeminiCurrentNodeGuard gate and head selection', () => {
  useGeminiRig()

  it('does no work on the timer or the log-triggered path while the group is off, and resumes once it is on', async () => {
    verdictAged(30 * MINUTE_MS)
    headOn('日本-1')
    restrictNodes()
    let open = false
    guard().startSparkleGeminiCurrentNodeGuardLoop(async () => open)

    await tick()
    logLine(GEMINI_LINE)
    await advance(SESSION_START_DELAY_MS)
    assert.deepEqual(world.calls, [])

    open = true
    await tick()
    assert.deepEqual(probes(), ['lock:日本-1'])
  })

  it('has nothing to verify when the group has no usable head', async () => {
    restrictNodes()
    guard().startSparkleGeminiCurrentNodeGuardLoop(GATE_OPEN)

    for (const [now, all] of [
      [undefined, []],
      ['   ', ['   ']],
      ['ghost', ['日本-1']]
    ] as const) {
      headOn(now, [...all])
      await tick()
    }

    assert.deepEqual(probes(), [])
  })

  it('verifies the head under its trimmed name', async () => {
    headOn(' 日本-1 ', ['日本-1'])
    restrictNodes()
    guard().startSparkleGeminiCurrentNodeGuardLoop(GATE_OPEN)

    await tick()

    assert.deepEqual(probes(), ['lock:日本-1'])
  })
})
