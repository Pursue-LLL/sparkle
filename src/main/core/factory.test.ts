import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import yaml from 'yaml'
import {
  flush,
  GROUP,
  groupNames,
  loadFactoryRig,
  WALL_CLOCK_MS,
  type FactoryRig,
  type RigState
} from './factoryRig'

describe('factory: generation lifecycle', () => {
  let rig: FactoryRig
  let state: RigState

  before(async () => {
    rig = await loadFactoryRig()
    state = rig.state
  })
  beforeEach(() => rig.reset())
  afterEach(() => mock.timers.reset())
  after(() => rig.dispose())

  const timedOut = async (generation: Promise<void>): Promise<Error> => {
    const outcome = generation.then(
      () => undefined,
      (error: Error) => error
    )
    await flush()
    mock.timers.tick(WALL_CLOCK_MS)
    return (await outcome) as Error
  }

  describe('when generation goes wrong', () => {
    it('gives up on a stuck generation, names the step it stuck on and falls back to the config on disk', async () => {
      writeFileSync(
        rig.configFile('work'),
        yaml.stringify({ 'proxy-groups': [{ name: '磁盘组' }] })
      )
      mock.timers.enable({ apis: ['setTimeout'] })
      state.hangProfile = true

      const error = await timedOut(rig.factory.generateProfile())

      const failure = `generateProfile wall-clock timeout after ${WALL_CLOCK_MS}ms last_step=begin`
      assert.equal(error.message, failure)
      await rig.waitForLog('hydrate_runtime_from_disk groups=1')
      assert.ok(
        state.logs.includes(`[Factory]: generateProfile failed err=${failure} last_step=begin\n`)
      )
      assert.deepEqual(groupNames(await rig.runtime()), ['磁盘组'])
      assert.match(await rig.factory.getRuntimeConfigStr(), /磁盘组/)
    })

    it('names the step it is on even when writing the log line for it is what hangs', async () => {
      await rig.factory.generateProfile()
      mock.timers.enable({ apis: ['setTimeout'] })
      state.hangLog = true

      const error = await timedOut(rig.factory.generateProfile())

      assert.match(error.message, /last_step=begin$/)
    })

    it('runs the next generation normally after a failure', async () => {
      state.profileError = new Error('boom')
      await assert.rejects(rig.factory.generateProfile(), /boom/)
      state.profileError = undefined

      await rig.factory.generateProfile()

      assert.ok(groupNames(await rig.runtime()).includes(GROUP))
    })

    it('reports a failing generation with its error and keeps serving the previous config', async () => {
      await rig.factory.generateProfile()
      const previous = await rig.factory.getRuntimeConfigStr()

      for (const [thrown, reported] of [
        [new Error('boom'), 'boom'],
        ['plain text', 'plain text']
      ] as const) {
        state.logs = []
        state.profileError = thrown
        await assert.rejects(rig.factory.generateProfile(), (error) => error === thrown)
        await rig.waitForLog(`generateProfile failed err=${reported} last_step=begin`)
      }

      assert.equal(await rig.factory.getRuntimeConfigStr(), previous)
      assert.equal(
        state.logs.some((line) => line.includes('hydrate_runtime_from_disk')),
        false
      )
    })

    it('does not leave its watchdog timer behind, however generation ends', async () => {
      mock.timers.enable({ apis: ['setTimeout'] })
      const startTimer = globalThis.setTimeout
      const stopTimer = globalThis.clearTimeout
      const watchdogs: unknown[] = []
      const cleared: unknown[] = []
      const spies = [
        mock.method(globalThis, 'setTimeout', ((handler: () => void, delay?: number) => {
          const handle = startTimer(handler, delay)
          if (delay === WALL_CLOCK_MS) watchdogs.push(handle)
          return handle
        }) as typeof setTimeout),
        mock.method(globalThis, 'clearTimeout', ((handle: Parameters<typeof clearTimeout>[0]) => {
          cleared.push(handle)
          stopTimer(handle)
        }) as typeof clearTimeout)
      ]

      try {
        await rig.factory.generateProfile()
        state.profileError = new Error('boom')
        await rig.factory.generateProfile().catch(() => undefined)
      } finally {
        for (const spy of spies) spy.mock.restore()
      }

      assert.equal(watchdogs.length, 2)
      assert.ok(watchdogs.every((handle) => cleared.includes(handle)))
    })

    it('runs one generation at a time, in the order they were asked for', async () => {
      let release = (): void => undefined
      state.gate = new Promise<void>((resolve) => {
        release = resolve
      })

      const first = rig.factory.generateProfile()
      const second = rig.factory.generateProfile()
      await flush()
      await flush()
      assert.equal(state.profileReads, 1, 'the second run waits for the first')

      release()
      await Promise.all([first, second])
      assert.equal(state.profileReads, 2)
    })
  })

  describe('progress reporting', () => {
    it('measures every step on one clock', async () => {
      let clock = 1_000
      const spy = mock.method(performance, 'now', () => (clock += 5))

      try {
        await rig.factory.generateProfile()
      } finally {
        spy.mock.restore()
      }

      const elapsed = state.logs
        .flatMap((line) => /elapsed_ms=(\d+)/.exec(line)?.[1] ?? [])
        .map(Number)
      assert.equal(elapsed.length, rig.steps().length)
      assert.deepEqual(
        elapsed,
        elapsed.map((_, index) => (index + 1) * 5)
      )
    })

    it('checks for build drift once per generation', async () => {
      await rig.factory.generateProfile()
      await rig.factory.generateProfile()

      assert.equal(state.buildDriftCalls, 2)
    })
  })

  describe('a profile with its own work directory', () => {
    it('writes the config for that profile and seeds its data files once', async () => {
      state.appConfig = { diffWorkDir: true }
      const target = path.join(rig.profileWorkRoot, 'p1')
      mkdirSync(target, { recursive: true })
      writeFileSync(path.join(rig.workDir, 'geoip.dat'), 'new')
      writeFileSync(path.join(rig.workDir, 'cache.db'), 'cache')
      writeFileSync(path.join(rig.workDir, 'notes.txt'), 'not data')
      writeFileSync(path.join(target, 'geoip.dat'), 'customised')

      await rig.factory.generateProfile()

      assert.equal(
        readFileSync(rig.configFile('p1'), 'utf8'),
        await rig.factory.getRuntimeConfigStr()
      )
      assert.equal(existsSync(rig.configFile('work')), false)
      assert.deepEqual(readdirSync(target).sort(), ['cache.db', 'geoip.dat'])
      assert.equal(readFileSync(path.join(target, 'geoip.dat'), 'utf8'), 'customised')
      assert.equal(rig.steps().at(-2), 'prepare_work_dir')
    })

    it('creates the directory when it does not exist yet', async () => {
      state.appConfig = { diffWorkDir: true }

      await rig.factory.generateProfile()

      assert.ok(existsSync(path.join(rig.profileWorkRoot, 'p1')))
    })
  })

  describe('the config on disk', () => {
    it('is read from the profile’s own file when it has its own work directory', async () => {
      state.appConfig = { diffWorkDir: true }
      writeFileSync(rig.configFile('p1'), yaml.stringify({ 'proxy-groups': [{ name: 'own' }] }))
      writeFileSync(
        rig.configFile('work'),
        yaml.stringify({ 'proxy-groups': [{ name: 'shared' }] })
      )

      assert.deepEqual(await rig.factory.loadRuntimeConfigFromDisk(), {
        'proxy-groups': [{ name: 'own' }]
      })
    })

    it('is nothing when the file is missing, unparseable or holds a bare value', async () => {
      assert.equal(await rig.factory.loadRuntimeConfigFromDisk(), null)

      for (const content of ['a: [unclosed', 'just text']) {
        writeFileSync(rig.configFile('work'), content)
        assert.equal(await rig.factory.loadRuntimeConfigFromDisk(), null, content)
      }
    })

    it('is an empty config when the file is empty', async () => {
      writeFileSync(rig.configFile('work'), '')

      assert.deepEqual(await rig.factory.loadRuntimeConfigFromDisk(), {})
    })

    it('is adopted while memory is empty, and left alone once memory has a group', async () => {
      writeFileSync(
        rig.configFile('work'),
        yaml.stringify({ 'proxy-groups': [{ name: '磁盘组' }] })
      )

      assert.equal(await rig.factory.hydrateRuntimeConfigFromDiskIfEmpty(), true)
      assert.ok(state.logs.includes('[Factory]: hydrate_runtime_from_disk groups=1\n'))
      assert.match(await rig.factory.getRuntimeConfigStr(), /磁盘组/)

      writeFileSync(
        rig.configFile('work'),
        yaml.stringify({ 'proxy-groups': [{ name: '另一份' }] })
      )
      assert.equal(await rig.factory.hydrateRuntimeConfigFromDiskIfEmpty(), false)
      assert.deepEqual(groupNames(await rig.runtime()), ['磁盘组'])
    })

    it('is not adopted when there is nothing on disk', async () => {
      assert.equal(await rig.factory.hydrateRuntimeConfigFromDiskIfEmpty(), false)

      assert.equal(await rig.factory.getRuntimeConfig(), undefined)
      assert.equal(await rig.factory.getRuntimeConfigStr(), undefined)
    })

    it('is adopted even without groups, and reported as such', async () => {
      writeFileSync(rig.configFile('work'), yaml.stringify({ 'mixed-port': 7890 }))

      assert.equal(await rig.factory.hydrateRuntimeConfigFromDiskIfEmpty(), true)

      assert.ok(state.logs.includes('[Factory]: hydrate_runtime_from_disk groups=0\n'))
    })

    it('is not adopted over a generated config', async () => {
      await rig.factory.generateProfile()
      writeFileSync(
        rig.configFile('work'),
        yaml.stringify({ 'proxy-groups': [{ name: '磁盘组' }] })
      )

      assert.equal(await rig.factory.hydrateRuntimeConfigFromDiskIfEmpty(), false)
      assert.ok(groupNames(await rig.runtime()).includes(GROUP))
    })
  })
})
