import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  agyCli,
  AICODE_REJECTION_LOG,
  AICODE_TIMEOUT_LOG,
  assertNoLog,
  cacheFileExists,
  cacheKey,
  HOUR_MS,
  NOW,
  OK_BUT_AICODE_REJECTED,
  outcomesByNode,
  probeCliDir,
  readCache,
  runBootstrap,
  snapshot,
  TW1,
  useAgyRig,
  world,
  type CliOutcome
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

const logDir = (): string => path.join(probeCliDir(), 'log')

const logFileOfSpawn = (index: number): string => {
  const { args } = world.spawns[index]
  return args[args.indexOf('--log-file') + 1]
}

/** 让下一次 CLI 运行得到 `outcome`，直接取回被归类后的 HTTP 状态与判定依据。 */
async function classified(outcome: CliOutcome): Promise<{ status: number; body: string }> {
  world.defaultOutcome = outcome
  const response = await agyCli().requestNativeAgy(90_000)
  if (response.kind !== 'response') {
    assert.fail(`expected a response, got ${response.kind}`)
  }
  return response
}

describe('sparkleAgyProbe CLI log file', () => {
  it('gives every run its own log file inside the probe directory', async () => {
    await agyCli().requestNativeAgy(90_000)
    await agyCli().requestNativeAgy(90_000)

    const [first, second] = [logFileOfSpawn(0), logFileOfSpawn(1)]
    assert.equal(path.dirname(first), logDir())
    assert.equal(path.dirname(second), logDir())
    assert.match(path.basename(first), /^probe-\d+-\d+\.log$/)
    assert.notEqual(first, second)
  })

  it('gives concurrent runs different log files', async () => {
    await Promise.all([agyCli().requestNativeAgy(90_000), agyCli().requestNativeAgy(90_000)])

    assert.notEqual(logFileOfSpawn(0), logFileOfSpawn(1))
  })
})

describe('sparkleAgyProbe location rejected only in the CLI log', () => {
  it('judges the node unusable although the process succeeded', async () => {
    outcomesByNode({ '台湾-1': OK_BUT_AICODE_REJECTED })

    await runBootstrap(agy())

    assert.equal(readCache()[cacheKey(TW1)].usable, false)
    assert.equal(world.probedVia.filter((node) => node === '台湾-1').length, 2)
    assert.deepEqual(
      [snapshot()['台湾-1'].state, snapshot()['台湾-1'].reason],
      ['unusable', '地区不支持']
    )
  })

  it('answers 400 and keeps the rejecting passage as the evidence', async () => {
    const { status, body } = await classified(OK_BUT_AICODE_REJECTED)

    assert.equal(status, 400)
    assert.match(body, /LOCATION_NOT_ELIGIBLE/)
    assert.ok(body.length < AICODE_REJECTION_LOG.length, 'only the passage, not the whole log')
  })

  it('recognizes the rejection in any letter case', async () => {
    const { status } = await classified({ kind: 'ok', log: AICODE_REJECTION_LOG.toLowerCase() })

    assert.equal(status, 400)
  })

  it('puts the rejection before an error text that looks like a login problem', async () => {
    const { status } = await classified({
      kind: 'chunks',
      chunks: [{ stream: 'stderr', text: 'PERMISSION_DENIED' }],
      code: 1,
      log: AICODE_REJECTION_LOG
    })

    assert.equal(status, 400)
  })

  it('leaves a run alone whose aicode request merely timed out', async () => {
    const { status } = await classified({ kind: 'ok', log: AICODE_TIMEOUT_LOG })

    assert.equal(status, 200)
  })

  it('trusts a successful run that left no log behind', async () => {
    const { status } = await classified({ kind: 'ok' })

    assert.equal(status, 200)
  })

  it('does not read the log of a run that had to be killed for being too slow', async () => {
    outcomesByNode({ '台湾-1': { kind: 'hang', log: AICODE_REJECTION_LOG } })

    await runBootstrap(agy())

    assert.equal(snapshot()['台湾-1'].reason, '超时')
    assert.equal(cacheFileExists(), false)
    assertNoLog('error=')
  })
})

describe('sparkleAgyProbe log cleanup', () => {
  function add(name: string, ageMs: number): void {
    mkdirSync(logDir(), { recursive: true })
    const file = path.join(logDir(), name)
    writeFileSync(file, 'x')
    const seconds = (NOW - ageMs) / 1000
    utimesSync(file, seconds, seconds)
  }

  it('removes logs older than a day, whoever named them, and keeps everything else', async () => {
    add('probe-1-1.log', 25 * HOUR_MS)
    add('cli-20261107_133824.log', 48 * HOUR_MS)
    add('just-over.log', 24 * HOUR_MS + 1000)
    add('exactly-a-day.log', 24 * HOUR_MS)
    add('fresh.log', 23 * HOUR_MS)
    add('notes.txt', 48 * HOUR_MS)

    await runBootstrap(agy())

    assert.deepEqual(readdirSync(logDir()).sort(), ['exactly-a-day.log', 'fresh.log', 'notes.txt'])
  })

  it('carries on when an old log cannot be removed', async () => {
    mkdirSync(path.join(logDir(), 'stuck.log'), { recursive: true })
    const seconds = (NOW - 48 * HOUR_MS) / 1000
    utimesSync(path.join(logDir(), 'stuck.log'), seconds, seconds)

    await runBootstrap(agy())

    assert.equal(existsSync(path.join(logDir(), 'stuck.log')), true)
    assert.equal(world.spawns.length, 1)
    assertNoLog('error=')
  })

  it('starts no agy before the cleanup has finished', async () => {
    add('old.log', 25 * HOUR_MS)
    const stillThere: boolean[] = []
    world.onSpawn = () => {
      stillThere.push(existsSync(path.join(logDir(), 'old.log')))
    }

    await agyCli().requestNativeAgy(90_000)

    assert.deepEqual(stillThere, [false])
  })

  it('only cleans up once per process', async () => {
    await runBootstrap(agy())
    add('late.log', 48 * HOUR_MS)

    await runBootstrap(agy())

    assert.equal(existsSync(path.join(logDir(), 'late.log')), true)
  })
})
