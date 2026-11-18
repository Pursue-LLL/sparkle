import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { flush } from './groupFailoverEngineHarness'
import { NETWORK_MONITOR_STARTUP_GRACE_MS } from './networkStartupGraceCore'
import {
  advance,
  behavior,
  calls,
  logs,
  runBootstrap,
  settle,
  usePostCoreBootstrapRig
} from './postCoreBootstrapRig'

describe('postCoreBootstrap', () => {
  const bootstrap = usePostCoreBootstrapRig()

  describe('waitForMihomoControllerReady', () => {
    it('is ready as soon as the controller answers', async () => {
      assert.equal(await bootstrap().waitForMihomoControllerReady(), true)
      assert.deepEqual(logs, [])
    })

    it('retries every half second until the controller answers', async () => {
      let attempts = 0
      behavior.probe = async () => {
        attempts += 1
        if (attempts < 4) throw new Error('not yet')
      }

      const ready = bootstrap().waitForMihomoControllerReady(10_000)
      await flush()
      await advance(1499)
      assert.equal(attempts, 3)
      await advance(1)

      assert.equal(await ready, true)
      assert.equal(attempts, 4)
    })

    it('gives up at the deadline and logs the last error', async () => {
      let attempts = 0
      behavior.probe = async () => {
        attempts += 1
        throw new Error(`down ${attempts}`)
      }

      const ready = bootstrap().waitForMihomoControllerReady(2000)
      await flush()
      await advance(2500)

      assert.equal(await ready, false)
      assert.deepEqual(logs, [
        `[PostCoreBootstrap]: controller probe last_error=Error: down ${attempts}\n`
      ])
    })

    it('describes non-Error failures and truncates long ones', async () => {
      behavior.probe = () => Promise.reject({ code: 'ECONNREFUSED', pad: 'x'.repeat(1000) })

      const ready = bootstrap().waitForMihomoControllerReady(500)
      await flush()
      await advance(1000)

      assert.equal(await ready, false)
      const detail = logs[0].slice('[PostCoreBootstrap]: controller probe last_error='.length, -1)
      assert.equal(detail.length, 400)
      assert.ok(detail.startsWith('{"code":"ECONNREFUSED"'))
    })
  })

  describe('runPostCoreBootstrap', () => {
    const GATED = [
      'warmup:begin',
      'sync',
      'fast:bootstrap',
      'fast:loop',
      'sticky-pin',
      'failover',
      'profile-updater',
      'cursor-default'
    ]

    const run = (coreInit?: Promise<void>): Promise<void> => runBootstrap(bootstrap(), coreInit)

    it('starts every service in dependency order once the controller is ready', async () => {
      await run()

      assert.deepEqual(
        calls.filter((call) => GATED.includes(call)),
        GATED
      )
      for (const background of [
        'gemini:bootstrap',
        'gemini:loop',
        'mail:current-node',
        'mail:bootstrap',
        'mail:loop',
        'grok:bootstrap',
        'grok:loop',
        'agy:bootstrap',
        'agy:loop'
      ]) {
        assert.ok(calls.includes(background), background)
      }
      assert.ok(
        calls.indexOf('mail:current-node') < calls.indexOf('mail:bootstrap') &&
          calls.indexOf('mail:bootstrap') < calls.indexOf('mail:loop'),
        'mail probes start in order'
      )
      assert.ok(logs[0].includes('mihomo API ready'))
      assert.equal(calls.includes('release:all'), false, 'a fresh sync already released pins')
    })

    it('releases cached pins itself when the sync did not reload the config', async () => {
      behavior.syncResult = false

      await run()

      assert.ok(calls.indexOf('release:all') > calls.indexOf('sync'))
      assert.ok(calls.indexOf('release:all') < calls.indexOf('fast:bootstrap'))
    })

    it('does not wait forever for the core to finish initialising', async () => {
      const neverReady = new Promise<void>(() => {
        // 故意不落定：模拟内核一直没有初始化完成
      })
      const done = bootstrap().runPostCoreBootstrap(neverReady)
      await settle()
      assert.deepEqual<string[]>(calls, [])
      assert.deepEqual(logs, [])

      await advance(8000)
      await settle()
      await done

      assert.ok(calls.includes('failover'))
    })

    it('starts nothing when the controller never becomes reachable', async () => {
      behavior.probe = () => Promise.reject(new Error('down'))

      const done = bootstrap().runPostCoreBootstrap(Promise.resolve())
      await flush()
      await advance(31_000)
      await done

      assert.deepEqual<string[]>(calls, [])
      assert.ok(logs.some((line) => line.includes('not reachable after 30s')))
    })

    it('keeps failover running when every other step fails', async () => {
      behavior.failing = new Set([
        'sync',
        'fast:bootstrap',
        'gemini:bootstrap',
        'mail:current-node',
        'mail:bootstrap',
        'grok:bootstrap',
        'agy:bootstrap',
        'sticky-pin',
        'profile-updater',
        'cursor-default'
      ])

      await run()

      assert.ok(calls.includes('failover'))
      assert.ok(calls.includes('cursor-default'))
      for (const prefix of [
        '[PostCoreBootstrap]: runtime config sync failed: sync boom',
        '[SparkleFastOrder]: failed: fast:bootstrap boom',
        '[SparkleGeminiProbe]: bootstrap failed: gemini:bootstrap boom',
        '[SparkleMailProbe]: current node probe start failed: mail:current-node boom',
        '[SparkleMailProbe]: bootstrap failed: mail:bootstrap boom',
        '[SparkleGrokProbe]: bootstrap failed: grok:bootstrap boom',
        '[SparkleAgyProbe]: bootstrap failed: agy:bootstrap boom',
        '[AutoSelectSticky]: start failed: sticky-pin boom',
        '[ProfileUpdater]: init failed: profile-updater boom',
        '[PostCoreBootstrap]: Cursor dedicated VPS default failed: cursor-default boom'
      ]) {
        assert.ok(
          logs.some((line) => line.startsWith(prefix)),
          prefix
        )
      }
    })

    it('reports a failing failover start and carries on', async () => {
      behavior.failing = new Set(['failover'])

      await run()

      assert.ok(
        logs.some((line) => line.startsWith('[GroupFailover]: start failed: failover boom'))
      )
      assert.ok(calls.includes('profile-updater'))
    })

    it('says so when the Cursor default was left alone', async () => {
      behavior.cursorSwitched = false

      await run()

      assert.ok(
        logs.some((line) => line.includes('Cursor dedicated VPS default unchanged or skipped'))
      )
    })

    it('never rejects and still closes the warm-up window when every step fails', async () => {
      behavior.failing = new Set([
        'sync',
        'fast:bootstrap',
        'sticky-pin',
        'failover',
        'profile-updater',
        'cursor-default',
        'warmup:regional'
      ])

      await run()
      assert.equal(calls.filter((call) => call === 'warmup:end').length, 0)
      await advance(NETWORK_MONITOR_STARTUP_GRACE_MS)
      await settle()

      assert.equal(calls.filter((call) => call === 'warmup:begin').length, 1)
      assert.equal(calls.filter((call) => call === 'warmup:end').length, 1)
    })

    it('is not derailed by a logger that cannot write', async () => {
      behavior.logFails = true
      behavior.failing = new Set(['sync', 'fast:bootstrap', 'sticky-pin'])

      await run()

      assert.ok(calls.includes('failover'))
      assert.ok(calls.includes('cursor-default'))
    })

    describe('regional warm-up after the grace period', () => {
      it('waits out the grace period, warms the active groups, re-checks failures and ends the window', async () => {
        behavior.warmedGroups = 1
        await run()
        assert.equal(calls.includes('warmup:regional'), false)

        await advance(NETWORK_MONITOR_STARTUP_GRACE_MS - 1)
        assert.equal(calls.includes('warmup:regional'), false)
        await advance(1)
        await settle()

        const tail = calls.slice(calls.indexOf('groups') + 1)
        assert.ok(tail.indexOf('connections') < tail.indexOf('warmup:regional'))
        assert.ok(tail.indexOf('warmup:regional') < tail.indexOf('verify-failures'))
        assert.ok(tail.indexOf('verify-failures') < tail.indexOf('warmup:end'))
        assert.ok(
          logs.some((line) => line.includes('regional url-test warmup (1 groups) after 45s grace'))
        )
      })

      it('skips the re-check when nothing was warmed', async () => {
        await run()

        await advance(NETWORK_MONITOR_STARTUP_GRACE_MS)
        await settle()

        assert.equal(calls.includes('verify-failures'), false)
        assert.equal(calls.filter((call) => call === 'warmup:end').length, 1)
        assert.ok(logs.some((line) => line.includes('warmup skipped active_groups=1')))
      })

      it('still ends the window when the warm-up fails', async () => {
        behavior.failing = new Set(['warmup:regional'])
        await run()

        await advance(NETWORK_MONITOR_STARTUP_GRACE_MS)
        await settle()

        assert.equal(calls.filter((call) => call === 'warmup:end').length, 1)
        assert.ok(
          logs.some((line) => line.includes('regional url-test warmup failed: warmup boom'))
        )
      })
    })
  })
})
