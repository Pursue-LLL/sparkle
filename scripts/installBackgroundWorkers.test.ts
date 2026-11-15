import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { assertExit, EXIT } from './testing/installAssertions'
import { InstallSandbox, type RunningInstall, serviceWorld } from './testing/installSandbox'

/** 写入静默标记并把它的 mtime 拨到 `ageMinutes` 分钟之前。 */
function placeMarker(sandbox: InstallSandbox, ageMinutes: number): void {
  const marker = join(sandbox.stateDir, 'upgrade-in-progress')
  writeFileSync(marker, '')
  const stamp = new Date(Date.now() - ageMinutes * 60_000)
  utimesSync(marker, stamp, stamp)
}

async function waitUntil(
  condition: () => boolean,
  describeWait: () => string,
  timeoutMs = 15_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${describeWait()}`)
    await delay(25)
  }
}

function waitForOutput(run: RunningInstall, pattern: RegExp): Promise<void> {
  return waitUntil(
    () => pattern.test(run.output()),
    () => `${pattern} in:\n${run.output()}`
  )
}

function stop(run: RunningInstall): Promise<unknown> {
  process.kill(-run.pid, 'SIGTERM')
  return run.done
}

describe('background workers around the install transaction (sandboxed)', () => {
  let sandbox: InstallSandbox | undefined
  const daemons: RunningInstall[] = []

  afterEach(() => {
    // 常驻的看门狗在断言失败时也不能留下孤儿进程。
    for (const daemon of daemons.splice(0)) {
      try {
        process.kill(-daemon.pid, 'SIGKILL')
      } catch {
        // 已经停了
      }
    }
    sandbox?.dispose()
    sandbox = undefined
  })

  /** GUI 不在运行的沙箱：看门狗与调度器都面对「App 没开」的场景。 */
  const create = (): InstallSandbox => {
    sandbox = new InstallSandbox(serviceWorld({ oldRunning: false }))
    return sandbox
  }

  const startWatchdog = (sb: InstallSandbox, macos: string): RunningInstall => {
    const watchdog = sb.start({ SIM_MACOS: macos }, 'sparkle-gui-watchdog.sh')
    daemons.push(watchdog)
    return watchdog
  }

  describe('sparkle-profile-scheduler.sh', () => {
    const setup = (): { sb: InstallSandbox; env: Record<string, string> } => {
      const sb = create()
      const fakeApp = join(sb.root, 'fake-sparkle')
      writeFileSync(
        fakeApp,
        '#!/bin/sh\necho "$@" >> "$SIM_DIR/scheduler.calls"\n[ -z "$FAKE_APP_FAILS" ]\n'
      )
      chmodSync(fakeApp, 0o755)
      return { sb, env: { SPARKLE_APP_BIN: fakeApp } }
    }
    const outLog = (sb: InstallSandbox): string =>
      readFileSync(join(sb.stateDir, 'profile-scheduler.out.log'), 'utf8')

    it('asks the app to refresh due subscriptions when no upgrade is running', async () => {
      const { sb, env } = setup()
      assertExit(await sb.run(env, 'sparkle-profile-scheduler.sh'), EXIT.ok)
      assert.equal(sb.readSim('scheduler.calls'), '--sparkle-profile-update-due')
    })

    it('skips the tick while a fresh upgrade marker exists, and says why', async () => {
      const { sb, env } = setup()
      placeMarker(sb, 1)
      assertExit(await sb.run(env, 'sparkle-profile-scheduler.sh'), EXIT.ok)
      assert.equal(sb.readSim('scheduler.calls'), null, 'the app must not be started mid-install')
      assert.match(outLog(sb), /upgrade in progress — skip this tick/)
    })

    it('treats the marker as expired after its TTL so a crashed installer cannot stop refreshes forever', async () => {
      const { sb, env } = setup()
      placeMarker(sb, 14)
      await sb.run(env, 'sparkle-profile-scheduler.sh')
      assert.equal(sb.readSim('scheduler.calls'), null, 'still inside the TTL')

      placeMarker(sb, 16)
      await sb.run(env, 'sparkle-profile-scheduler.sh')
      assert.equal(sb.readSim('scheduler.calls'), '--sparkle-profile-update-due', 'past the TTL')
    })

    it('only warns when the app is missing', async () => {
      const { sb } = setup()
      const result = await sb.run(
        { SPARKLE_APP_BIN: join(sb.root, 'no-such-app') },
        'sparkle-profile-scheduler.sh'
      )
      assertExit(result, EXIT.ok)
      assert.match(outLog(sb), /WARN: Sparkle missing/)
    })

    it('logs a failing refresh without failing the worker', async () => {
      const { sb, env } = setup()
      const result = await sb.run({ ...env, FAKE_APP_FAILS: '1' }, 'sparkle-profile-scheduler.sh')
      assertExit(result, EXIT.ok)
      assert.match(outLog(sb), /profile update due command exited non-zero/)
    })
  })

  describe('sparkle-gui-watchdog.sh', () => {
    const ledger = (sb: InstallSandbox): string =>
      readFileSync(join(sb.stateDir, 'gui-crash-ledger.jsonl'), 'utf8')
    const relaunches = (sb: InstallSandbox): string[] =>
      sb.callsOf('osascript').filter((line) => line.includes('open POSIX file'))

    it('relaunches a GUI that disappeared when no upgrade is running (control for the tests below)', async () => {
      const sb = create()
      const watchdog = startWatchdog(sb, '15.0')
      await waitForOutput(watchdog, /unexpected GUI exit — relaunching Sparkle/)
      await waitUntil(
        () => sb.guiRunning(),
        () => 'the relaunched GUI'
      )
      await stop(watchdog)
      assert.equal(relaunches(sb).length, 1)
      assert.equal(ledger(sb).trim().split('\n').length, 1)
    })

    it('does not treat the installer stopping the app as a crash: no ledger entry, no relaunch', async () => {
      const sb = create()
      placeMarker(sb, 1)
      const watchdog = startWatchdog(sb, '15.0')
      await waitForOutput(watchdog, /upgrade in progress — watchdog paused/)
      await delay(1000)
      await stop(watchdog)
      assert.deepEqual(relaunches(sb), [])
      assert.equal(ledger(sb).trim(), '')
      assert.doesNotMatch(watchdog.output(), /unexpected GUI exit/)
    })

    it('resumes watching once the installer clears its marker', async () => {
      const sb = create()
      placeMarker(sb, 1)
      const watchdog = startWatchdog(sb, '15.0')
      await waitForOutput(watchdog, /watchdog paused/)
      rmSync(join(sb.stateDir, 'upgrade-in-progress'))
      await waitForOutput(watchdog, /upgrade finished — watchdog resumed/)
      await waitForOutput(watchdog, /unexpected GUI exit — relaunching Sparkle/)
      await waitUntil(
        () => sb.guiRunning(),
        () => 'the relaunched GUI'
      )
      await stop(watchdog)
      assert.equal(relaunches(sb).length, 1)
    })

    it('ignores a marker older than its TTL', async () => {
      const sb = create()
      placeMarker(sb, 20)
      const watchdog = startWatchdog(sb, '15.0')
      await waitForOutput(watchdog, /unexpected GUI exit — relaunching Sparkle/)
      await waitUntil(
        () => sb.guiRunning(),
        () => 'the relaunched GUI'
      )
      await stop(watchdog)
      assert.doesNotMatch(watchdog.output(), /watchdog paused/)
    })

    it('keeps its existing macOS 26 policy: records the exit but never relaunches the GUI', async () => {
      const sb = create()
      const watchdog = startWatchdog(sb, '26.5.2')
      await waitForOutput(watchdog, /macOS 26 — GUI auto-relaunch disabled/)
      await stop(watchdog)
      assert.deepEqual(relaunches(sb), [])
      assert.match(ledger(sb), /macos26_no_relaunch/)
    })
  })

  describe('LaunchAgent installers', () => {
    const INSTALLERS = [
      {
        script: 'install-sparkle-profile-scheduler.sh',
        label: 'com.sparkle.profile-scheduler',
        worker: 'sparkle-profile-scheduler.sh',
        tag: 'install-profile-scheduler'
      },
      {
        script: 'install-sparkle-gui-watchdog.sh',
        label: 'com.sparkle.gui-watchdog',
        worker: 'sparkle-gui-watchdog.sh',
        tag: 'install-gui-watchdog'
      }
    ]

    for (const { script, label, worker, tag } of INSTALLERS) {
      describe(script, () => {
        const plistOf = (sb: InstallSandbox): string => join(sb.launchAgentsDir, `${label}.plist`)
        const deployed = (sb: InstallSandbox): string => join(sb.stateDir, worker)
        const launchctl = (sb: InstallSandbox, verb: string): string[] =>
          sb.callsOf('launchctl').filter((line) => line.startsWith(`launchctl ${verb} `))

        it('deploys the worker and loads the job on a fresh machine', async () => {
          const sb = create()
          const result = await sb.run({}, script)
          assertExit(result, EXIT.ok)
          assert.match(result.output, new RegExp(`\\[${tag}\\] Installed ${label}`))
          assert.equal(
            readFileSync(deployed(sb), 'utf8'),
            readFileSync(join(sb.repo, 'scripts', worker), 'utf8'),
            'the deployed worker must be the current one'
          )
          const plist = readFileSync(plistOf(sb), 'utf8')
          assert.ok(
            plist.includes(`<string>${deployed(sb)}</string>`),
            'the plist must run the deployed worker'
          )
          assert.equal(launchctl(sb, 'bootstrap').length, 1)
        })

        it('is idempotent: an identical, loaded job is left alone', async () => {
          const sb = create()
          await sb.run({}, script)
          const before = sb.calls().length
          const result = await sb.run({}, script)
          assertExit(result, EXIT.ok)
          assert.match(result.output, /unchanged and loaded from .* — skipping reinstall/)
          const added = sb
            .calls()
            .slice(before)
            .filter((line) => /^launchctl (bootout|bootstrap|enable|kickstart) /.test(line))
          assert.deepEqual(
            added,
            [],
            'reinstalling needlessly resets the watchdog ledger and the schedule phase'
          )
        })

        it('reinstalls when the deployed worker is stale', async () => {
          const sb = create()
          await sb.run({}, script)
          writeFileSync(
            deployed(sb),
            '#!/bin/bash\n# an old copy that ignores the upgrade marker\n'
          )
          const result = await sb.run({}, script)
          assertExit(result, EXIT.ok)
          assert.match(result.output, /Installed/)
          assert.equal(
            readFileSync(deployed(sb), 'utf8'),
            readFileSync(join(sb.repo, 'scripts', worker), 'utf8')
          )
          assert.equal(launchctl(sb, 'bootstrap').length, 2)
        })

        it('reinstalls when launchd loaded the job from a different plist', async () => {
          // 沙箱 shell 的 HOME 被改写过时就会发生：文件都对，但生效的是另一份。
          const sb = create()
          await sb.run({}, script)
          writeFileSync(join(sb.simDir, `launchd.${label}`), '/somewhere/else/agent.plist')
          const result = await sb.run({}, script)
          assertExit(result, EXIT.ok)
          assert.match(result.output, /Installed/)
          assert.equal(launchctl(sb, 'bootstrap').length, 2)
          assert.equal(sb.readSim(`launchd.${label}`), plistOf(sb))
        })

        it('reinstalls when the job is not loaded at all', async () => {
          const sb = create()
          await sb.run({}, script)
          rmSync(join(sb.simDir, `launchd.${label}`))
          assertExit(await sb.run({}, script), EXIT.ok)
          assert.equal(launchctl(sb, 'bootstrap').length, 2)
        })

        it('reinstalls when the plist content drifted', async () => {
          const sb = create()
          await sb.run({}, script)
          writeFileSync(plistOf(sb), '<plist>tampered</plist>\n')
          assertExit(await sb.run({}, script), EXIT.ok)
          assert.equal(launchctl(sb, 'bootstrap').length, 2)
          assert.ok(readFileSync(plistOf(sb), 'utf8').includes(label))
        })

        it('writes into the login home even when the shell HOME is a sandbox', async () => {
          const sb = create()
          const sandboxHome = join(sb.root, 'agent-home')
          const env = {
            HOME: sandboxHome,
            SPARKLE_STATE_DIR: '',
            SPARKLE_LAUNCH_AGENTS_DIR: '',
            SPARKLE_APP_DATA_DIR: ''
          }
          assertExit(await sb.run(env, script), EXIT.ok)
          assert.equal(existsSync(plistOf(sb)), true, 'plist must land in the login home')
          assert.equal(
            existsSync(sandboxHome),
            false,
            'nothing may be written under the sandbox HOME'
          )
        })

        it('fails loudly when launchd refuses the job', async () => {
          const sb = create()
          const result = await sb.run({ SIM_FAIL_BOOTSTRAP: '1' }, script)
          assert.notEqual(result.code, EXIT.ok)
          assert.match(result.output, /Bootstrap failed/)
          assert.doesNotMatch(result.output, /Installed/)
        })
      })
    }
  })
})
