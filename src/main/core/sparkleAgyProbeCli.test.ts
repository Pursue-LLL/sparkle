import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  assertLog,
  assertNoLog,
  cacheFileExists,
  cacheKey,
  callsStarting,
  HANG,
  homeDir,
  HOUR_MS,
  LOCATION,
  NOW,
  outcomesByNode,
  probeCliDir,
  probeDir,
  readCache,
  runBootstrap,
  TW1,
  useAgyRig,
  world,
  type CliOutcome
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

const text = (stream: 'stdout' | 'stderr', body: string, code: number): CliOutcome => ({
  kind: 'chunks',
  chunks: [{ stream, text: body }],
  code
})

describe('sparkleAgyProbe agy CLI request', () => {
  it('runs the official CLI with a private data directory and the cheap model', async () => {
    await runBootstrap(agy())

    const [spawned] = world.spawns
    assert.equal(spawned.bin, path.join(homeDir(), '.local/bin/agy'))
    assert.deepEqual(spawned.args, [
      '--gemini_dir',
      probeDir(),
      '--print',
      'Reply with exactly: OK',
      '--model',
      'gemini-3.8-flash-low',
      '--print-timeout',
      '85s',
      '--output-format',
      'text'
    ])
  })

  it('keeps API overrides of the user session out of the probe', async () => {
    const overrides = [
      'GEMINI_API_KEY',
      'GOOGLE_GEMINI_BASE_URL',
      'GOOGLE_API_KEY',
      'CLOUD_CODE_URL'
    ]
    for (const name of overrides) {
      process.env[name] = 'from-the-user-session'
    }

    await runBootstrap(agy())

    const { env } = world.spawns[0]
    for (const name of overrides) {
      assert.equal(name in env, false, `${name} must not reach the probe`)
    }
    assert.equal(env.HOME, homeDir())
    assert.equal(env.PATH, process.env.PATH)
  })

  it('still reports a timeout when the stuck process cannot be killed', async () => {
    world.killFailure = true
    outcomesByNode({ '台湾-1': HANG })

    await runBootstrap(agy())

    assert.deepEqual(world.killed, ['SIGKILL'])
    assertNoLog('error=')
    assert.equal(agy().getSparkleAgyProbeSnapshot()['台湾-1'].reason, '超时')
  })
})

describe('sparkleAgyProbe reading the CLI result', () => {
  const rejections: Array<readonly [string, CliOutcome]> = [
    [
      'a location message on stdout even with exit code 0',
      text('stdout', 'User location is not supported', 0)
    ],
    ['a location message in any letter case', text('stderr', 'USER LOCATION IS NOT SUPPORTED', 1)]
  ]
  for (const [label, outcome] of rejections) {
    it(`judges the node unusable on ${label}`, async () => {
      outcomesByNode({ '台湾-1': outcome })

      await runBootstrap(agy())

      assert.equal(readCache()[cacheKey(TW1)].usable, false)
      assert.equal(world.probedVia.filter((node) => node === '台湾-1').length, 2)
    })
  }

  const failures: Array<readonly [string, string, string]> = [
    ['an authentication problem', 'FAILED_PRECONDITION: account not enabled', 'HTTP 403'],
    ['a permission problem', 'PERMISSION_DENIED', 'HTTP 403'],
    ['a missing login', 'error: not logged in', 'HTTP 403'],
    ['a sign-in request', 'please sign in to continue', 'HTTP 403'],
    ['an authentication failure', 'Authentication failed', 'HTTP 403'],
    ['any other error', 'quota exceeded', 'HTTP 500']
  ]
  for (const [label, body, reason] of failures) {
    it(`does not judge the node on ${label}`, async () => {
      outcomesByNode({ '台湾-1': text('stderr', body, 1) })

      await runBootstrap(agy())

      assert.equal(cacheFileExists(), false, 'no evidence about the node, so nothing is cached')
      assert.deepEqual(agy().getSparkleAgyProbeSnapshot()['台湾-1'], {
        rttMs: 0,
        checkedAt: NOW,
        state: 'failed',
        reason
      })
    })
  }

  const OUTPUT_CAP = 16_384
  for (const stream of ['stdout', 'stderr'] as const) {
    const padded = (length: number): CliOutcome => ({
      kind: 'chunks',
      chunks: [
        { stream, text: 'x'.repeat(length) },
        { stream, text: 'User location is not supported' }
      ],
      code: 1
    })

    it(`reads ${stream} up to the cap and ignores what comes after it`, async () => {
      outcomesByNode({ '台湾-1': padded(OUTPUT_CAP) })
      await runBootstrap(agy())
      assert.equal(cacheFileExists(), false, 'the marker came after the cap')
    })

    it(`still reads a ${stream} chunk that starts just below the cap`, async () => {
      outcomesByNode({ '台湾-1': padded(OUTPUT_CAP - 1) })
      await runBootstrap(agy())
      assert.equal(readCache()[cacheKey(TW1)].usable, false)
    })
  }
})

describe('sparkleAgyProbe probe directory', () => {
  const mainInstallationId = (): string =>
    path.join(homeDir(), '.gemini/antigravity-cli/installation_id')
  const probeInstallationId = (): string => path.join(probeCliDir(), 'installation_id')

  it('reuses the installation id of the main agy directory', async () => {
    mkdirSync(path.dirname(mainInstallationId()), { recursive: true })
    writeFileSync(mainInstallationId(), 'main-id')

    await runBootstrap(agy())

    assert.equal(readFileSync(probeInstallationId(), 'utf8'), 'main-id')
  })

  it('never replaces an installation id the probe already has', async () => {
    mkdirSync(path.dirname(mainInstallationId()), { recursive: true })
    writeFileSync(mainInstallationId(), 'main-id')
    mkdirSync(probeCliDir(), { recursive: true })
    writeFileSync(probeInstallationId(), 'probe-id')

    await runBootstrap(agy())

    assert.equal(readFileSync(probeInstallationId(), 'utf8'), 'probe-id')
  })

  it('probes anyway when the main directory has no installation id', async () => {
    await runBootstrap(agy())

    assert.equal(world.spawns.length, 1)
    assert.equal(existsSync(probeInstallationId()), false)
  })

  it('probes anyway when the probe directory cannot be created', async () => {
    writeFileSync(probeDir(), 'a file where the directory should be')

    await runBootstrap(agy())

    assert.equal(world.spawns.length, 1)
    assertNoLog('error=')
  })

  describe('conversation cleanup', () => {
    const conversations = (): string => path.join(probeCliDir(), 'conversations')

    function add(name: string, ageMs: number): void {
      const file = path.join(conversations(), name)
      writeFileSync(file, 'x')
      const seconds = (NOW - ageMs) / 1000
      utimesSync(file, seconds, seconds)
    }

    function arrange(): void {
      mkdirSync(conversations(), { recursive: true })
    }

    it('removes conversations older than a day and keeps everything else', async () => {
      arrange()
      add('old.db', 25 * HOUR_MS)
      add('old.db-wal', 25 * HOUR_MS)
      add('old.db-shm', 25 * HOUR_MS)
      add('just-over.db', 24 * HOUR_MS + 1000)
      add('exactly-a-day.db', 24 * HOUR_MS)
      add('fresh.db', 23 * HOUR_MS)
      add('notes.txt', 48 * HOUR_MS)

      await runBootstrap(agy())

      assert.deepEqual(readdirSync(conversations()).sort(), [
        'exactly-a-day.db',
        'fresh.db',
        'notes.txt'
      ])
    })

    it('carries on when an old entry cannot be removed', async () => {
      arrange()
      const stuck = path.join(conversations(), 'stuck.db')
      mkdirSync(stuck)
      utimesSync(stuck, (NOW - 48 * HOUR_MS) / 1000, (NOW - 48 * HOUR_MS) / 1000)

      await runBootstrap(agy())

      assert.equal(existsSync(stuck), true)
      assert.equal(world.spawns.length, 1)
      assertNoLog('error=')
    })

    it('only cleans up once per process', async () => {
      arrange()
      await runBootstrap(agy())
      add('late.db', 48 * HOUR_MS)

      await runBootstrap(agy())

      assert.equal(existsSync(path.join(conversations(), 'late.db')), true)
    })
  })
})

describe('sparkleAgyProbe attribution guard', () => {
  it('never attributes a verdict while the old connections cannot be cut', async () => {
    world.closeFailure = true

    await runBootstrap(agy())
    await runBootstrap(agy())

    assert.equal(world.spawns.length, 0, 'no request may run on an unattributable exit')
    assert.equal(cacheFileExists(), false)
    assertLog('pin 台湾-1 verdict=unknown streak=2')
    assertLog('(probed=0); keep 台湾-1 empty_rounds=1')
  })

  it('does not attribute a candidate result when the cut after switching fails', async () => {
    world.outcomes = [LOCATION, LOCATION]
    world.onSpawn = (count) => {
      world.closeFailure = count >= 2
    }

    await runBootstrap(agy())

    assert.equal(world.spawns.length, 2, 'only the pin was ever really probed')
    assert.equal(readCache()[cacheKey(TW1)].usable, false)
    assert.equal(Object.keys(readCache()).length, 1)
    assert.deepEqual(callsStarting('change:'), ['change:台湾-2'], 'switched to, but not trusted')
    assert.equal(world.selection, '台湾-2')
    assertLog('(probed=0)')
  })
})
