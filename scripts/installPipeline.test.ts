import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  assertLiveAppNeverDeleted,
  assertNothingChanged,
  assertOrder,
  assertRunning,
  assertTransactionClosed,
  elevationCalls,
  EXIT,
  assertExit,
  forceKillCalls,
  quitCalls
} from './testing/installAssertions'
import { InstallSandbox } from './testing/installSandbox'
import {
  type BundleSpec,
  NEW_BUNDLE,
  OLD_BUNDLE,
  serviceWorld,
  type WorldSpec
} from './testing/installWorld'

const HOMEBREW_BASH = '/opt/homebrew/bin/bash'

describe('install-sparkle-local.sh transaction (sandboxed)', () => {
  let sandbox: InstallSandbox | undefined

  afterEach(() => {
    sandbox?.dispose()
    sandbox = undefined
  })

  const create = (spec: WorldSpec): InstallSandbox => {
    sandbox = new InstallSandbox(spec)
    return sandbox
  }

  const sameBuild: BundleSpec = { ...NEW_BUNDLE }

  describe('happy path', () => {
    it('swaps in the new build with every step in the safe order and no password prompt', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run()

      assertExit(result, EXIT.ok)
      assertRunning(sb, NEW_BUNDLE.version)
      assertTransactionClosed(sb)
      assertLiveAppNeverDeleted(sb)
      assert.deepEqual(elevationCalls(sb), [], 'service mode must never prompt for a password')

      const log = sb.installLog().split('\n')
      let previous = -1
      for (const phase of [
        'staging',
        'quiesced',
        'swapping',
        'swapped',
        'launch + gate',
        'committed'
      ]) {
        const at = log.findIndex((line) => line.includes(`phase: ${phase}`))
        assert.ok(at > previous, `phase ${phase} must follow the previous one`)
        previous = at
      }
      assert.match(result.output, /health gate passed \(listener, data-plane, fresh-core, tun\)/)
      assert.match(result.output, /RESULT: Sparkle 1\.1\.0-new installed/)
    })

    it('stops the GUI with a plain SIGTERM, never an AppleEvent quit that would wait on its confirm dialog', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assert.equal(quitCalls(sb).length, 1)
      assert.deepEqual(
        forceKillCalls(sb),
        [],
        'SIGKILL is only the fallback for a GUI that ignores SIGTERM'
      )
      assert.equal(
        sb.callsOf('osascript').some((line) => line.includes('to quit')),
        false
      )
    })

    it('verifies and prepares the new bundle before the app is stopped', async () => {
      const sb = create(serviceWorld())
      await sb.run()
      const calls = sb.calls()
      assertOrder(calls, /^ditto /, /^pkill -TERM /, 'copy before stopping the app')
      assertOrder(
        calls,
        /^codesign --verify .*\.Sparkle\.staging/,
        /^pkill -TERM /,
        'staged signature check before stopping the app'
      )
    })

    it('stops the service-managed core so the new build starts a fresh one', async () => {
      const sb = create(serviceWorld())
      await sb.run()
      assert.equal(
        sb.callsOf('tsx').some((line) => line.includes('sparkle-service-core-stop.mts')),
        true
      )
      assert.equal(sb.corePath(), join(sb.dest, 'Contents/Resources/sidecar/mihomo'))
    })

    it('deploys marker-aware background workers before touching the app', async () => {
      const sb = create(serviceWorld())
      await sb.run()
      for (const worker of ['sparkle-profile-scheduler.sh', 'sparkle-gui-watchdog.sh']) {
        const deployed = readFileSync(join(sb.stateDir, worker), 'utf8')
        assert.match(deployed, /upgrade-in-progress/, worker)
      }
      assert.equal(
        sb.callsOf('launchctl').filter((line) => line.startsWith('launchctl bootstrap')).length,
        2
      )
      assertOrder(sb.calls(), /^launchctl bootstrap/, /^ditto /, 'workers refreshed before staging')
    })

    it('replaces background jobs that launchd loaded from another home and then installs normally', async () => {
      // 沙箱 shell 的 HOME 被改写时 launchd 会加载那份旧 plist，它调度的 worker 不认静默标记。
      const sb = create(serviceWorld())
      for (const label of ['com.sparkle.profile-scheduler', 'com.sparkle.gui-watchdog']) {
        writeFileSync(join(sb.simDir, `launchd.${label}`), `/sandbox-home/${label}.plist`)
      }
      const result = await sb.run()

      assertExit(result, EXIT.ok)
      for (const label of ['com.sparkle.profile-scheduler', 'com.sparkle.gui-watchdog']) {
        assert.equal(sb.readSim(`launchd.${label}`), join(sb.launchAgentsDir, `${label}.plist`))
      }
      assertRunning(sb, NEW_BUNDLE.version)
    })

    it('records the installed CDHash and keeps a readable log of the last run', async () => {
      const sb = create(serviceWorld())
      await sb.run()
      assert.equal(
        readFileSync(join(sb.stateDir, 'last-sparkle-cdhash'), 'utf8').trim(),
        NEW_BUNDLE.cdhash
      )
      assert.match(sb.installLog(), /\d\d:\d\d:\d\d \[install-sparkle\] phase: committed/)
    })

    it('does not fail a committed install because the CDHash note cannot be written', async () => {
      // 收尾只是记账：此刻新包已验证、旧包已删，不能因为记不了账就让安装以失败退出。
      const sb = create(serviceWorld())
      mkdirSync(join(sb.stateDir, 'last-sparkle-cdhash'))
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assert.match(result.output, /WARN: could not record the installed CDHash/)
      assert.match(result.output, /RESULT: Sparkle 1\.1\.0-new installed/)
      assertRunning(sb, NEW_BUNDLE.version)
      assertTransactionClosed(sb)
    })

    it('parks a duplicate per-user install so the service and the GUI cannot split', async () => {
      const sb = create(serviceWorld())
      const applications = join(sb.home, 'Applications')
      mkdirSync(join(applications, 'Sparkle.app', 'Contents'), { recursive: true })
      writeFileSync(join(applications, 'Sparkle.app', 'Contents', 'note'), 'stale user copy')
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assert.match(result.output, /Moved duplicate user install/)
      assert.equal(existsSync(join(applications, 'Sparkle.app')), false)
      const parked = readdirSync(applications).filter((name) => name.startsWith('Sparkle.app.bak.'))
      assert.equal(parked.length, 1, 'the copy is kept, not deleted')
      assert.equal(
        readFileSync(join(applications, parked[0], 'Contents', 'note'), 'utf8'),
        'stale user copy'
      )
    })

    it('only warns when the duplicate per-user install cannot be parked', async () => {
      const sb = create(serviceWorld())
      const userCopy = join(sb.home, 'Applications', 'Sparkle.app')
      mkdirSync(userCopy, { recursive: true })
      const result = await sb.run({ SIM_FAIL_MV: 'mv_user_copy' })
      assertExit(result, EXIT.ok)
      assert.match(result.output, /WARN: could not move duplicate user install/)
      assert.equal(existsSync(userCopy), true)
      assertRunning(sb, NEW_BUNDLE.version)
    })

    it('keeps the previous run log when it starts a new one', async () => {
      const sb = create(serviceWorld())
      await sb.run()
      const first = sb.installLog()
      await sb.run({ SPARKLE_FORCE_REINSTALL: '1' })
      assert.equal(readFileSync(join(sb.stateDir, 'install-prev.log'), 'utf8'), first)
    })

    it('tells the user when the bundled service binary changed instead of forcing a prompt', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run()
      assert.match(result.output, /bundled sparkle-service changed/)
      assert.deepEqual(elevationCalls(sb), [])
    })

    it(
      'works under a newer bash as well as the system bash 3.2',
      { skip: !existsSync(HOMEBREW_BASH) },
      async () => {
        const sb = create(serviceWorld())
        const result = await sb.run({}, 'install-sparkle-local.sh', HOMEBREW_BASH)
        assertExit(result, EXIT.ok)
        assertRunning(sb, NEW_BUNDLE.version)
      }
    )

    it('installs on a machine that has no previous app', async () => {
      const sb = create(serviceWorld({ old: null }))
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assert.equal(sb.destVersion(), NEW_BUNDLE.version)
      assert.equal(sb.guiRunning(), true)
      assertTransactionClosed(sb)
    })

    it('accepts a headless macOS 26 build whose GUI exits after bootstrapping the core', async () => {
      const next = { ...NEW_BUNDLE, behavior: { headless: '1' } }
      const sb = create(serviceWorld({ forceGui: false, next }))
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assert.equal(sb.guiRunning(), false)
      assert.equal(sb.proxy(), 'up')
      assert.equal(sb.destVersion(), NEW_BUNDLE.version)
    })

    it('does not blame the new build for a network that was already down', async () => {
      const next = { ...NEW_BUNDLE, behavior: { traffic: 'fail' } }
      const sb = create(serviceWorld({ network: 'down', next }))
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assert.doesNotMatch(result.output, /health gate passed \([^)]*data-plane/)
      assert.equal(sb.destVersion(), NEW_BUNDLE.version)
    })
  })

  describe('elevated mode on an older macOS', () => {
    const elevated = (overrides: Partial<WorldSpec> = {}): WorldSpec =>
      serviceWorld({
        mode: 'elevated',
        darwin: '24.6.0',
        old: { ...OLD_BUNDLE, coreSetuid: true },
        ...overrides
      })

    it('asks for the password exactly once, before anything irreversible, and hands over a setuid core', async () => {
      const sb = create(elevated())
      const result = await sb.run({ SIM_ELEVATION: 'grant' })
      assertExit(result, EXIT.ok)
      assert.equal(elevationCalls(sb).length, 1)
      assertOrder(sb.calls(), /administrator privileges/, /^pkill -TERM /, 'elevation before stop')
      // 先验证原样拷贝，再改属主与权限位：被验证的必须是未被改动过的那份字节。
      assertOrder(
        sb.calls(),
        /^codesign --verify .*\.Sparkle\.staging/,
        /administrator privileges/,
        'staged copy verified before its permissions are changed'
      )
      assert.equal(sb.coreSetuidBit(), true)
      assertRunning(sb, NEW_BUNDLE.version)
    })

    it('leaves the running app alone when the user cancels the password prompt', async () => {
      const sb = create(elevated())
      const result = await sb.run({ SIM_ELEVATION: 'deny' })
      assertExit(result, EXIT.failed)
      assert.match(result.output, /User canceled/)
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('refuses to prompt in non-interactive mode and changes nothing', async () => {
      const sb = create(elevated())
      const result = await sb.run({ SPARKLE_NONINTERACTIVE: '1' })
      assertExit(result, EXIT.failed)
      assert.match(result.output, /non-interactive mode forbids elevation/)
      assert.deepEqual(elevationCalls(sb), [])
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('does not prompt when TUN is off', async () => {
      const sb = create(elevated({ tun: false }))
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assert.deepEqual(elevationCalls(sb), [])
    })
  })

  describe('short-circuit when the same build is already healthy', () => {
    const identical = (overrides: Partial<WorldSpec> = {}): WorldSpec =>
      serviceWorld({ old: sameBuild, next: sameBuild, ...overrides })
    const markerPath = (sb: InstallSandbox): string => join(sb.root, 'short-circuit.marker')

    it('touches nothing and tells the parent flow it was a no-op', async () => {
      const sb = create(identical())
      const inodeBefore = statSync(sb.dest).ino
      const result = await sb.run({ SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb) })

      assertExit(result, EXIT.ok)
      assert.match(result.output, /Same build already installed and healthy/)
      assert.equal(existsSync(markerPath(sb)), true)
      assert.equal(statSync(sb.dest).ino, inodeBefore)
      assert.deepEqual(quitCalls(sb), [])
      assert.deepEqual(sb.callsOf('ditto'), [])
      assert.equal(
        sb.callsOf('mv').some((line) => line.includes('Sparkle.app')),
        false
      )
      assertTransactionClosed(sb)
    })

    it('short-circuits a headless macOS 26 install whose GUI is legitimately absent', async () => {
      const sb = create(identical({ forceGui: false }))
      rmSync(join(sb.simDir, 'gui.pid'))
      const result = await sb.run({ SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb) })
      assertExit(result, EXIT.ok)
      assert.equal(existsSync(markerPath(sb)), true)
    })

    const reinstallCases: Array<[string, Partial<WorldSpec>, Record<string, string>, RegExp]> = [
      ['the app is not running', { oldRunning: false }, {}, /Reinstall required: app_not_running/],
      [
        'the data plane was already down',
        { network: 'down' },
        {},
        /Reinstall required: data_plane_down/
      ],
      ['a reinstall is forced', {}, { SPARKLE_FORCE_REINSTALL: '1' }, /phase: staging/]
    ]
    for (const [name, overrides, env, expected] of reinstallCases) {
      it(`does a real install when ${name}`, async () => {
        const sb = create(identical(overrides))
        const result = await sb.run({
          SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb),
          ...env
        })
        assertExit(result, EXIT.ok)
        assert.match(result.output, expected)
        assert.equal(existsSync(markerPath(sb)), false)
        assert.equal(sb.callsOf('ditto').length, 1)
        assertTransactionClosed(sb)
      })
    }

    it('treats a missing setuid on an elevated TUN install as a defect to fix, not as healthy', async () => {
      const sb = create(
        identical({
          mode: 'elevated',
          darwin: '24.6.0',
          old: { ...sameBuild, coreSetuid: false },
          next: sameBuild
        })
      )
      const result = await sb.run({
        SIM_ELEVATION: 'grant',
        SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb)
      })
      assertExit(result, EXIT.ok)
      assert.match(result.output, /Reinstall required: core_setuid_missing/)
      assert.equal(sb.coreSetuidBit(), true)
    })

    it('does not demand setuid in service mode, so a service install is stable across runs', async () => {
      const sb = create(identical())
      writeFileSync(join(sb.dest, 'Contents', 'touch-marker'), '')
      const first = await sb.run({ SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb) })
      const second = await sb.run({ SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb) })
      assertExit(first, EXIT.ok)
      assertExit(second, EXIT.ok)
      assert.deepEqual(sb.callsOf('ditto'), [])
      assert.deepEqual(elevationCalls(sb), [])
    })
  })
})
