import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  assertExit,
  assertLiveAppNeverDeleted,
  assertNothingChanged,
  assertRestored,
  assertRunning,
  assertTransactionClosed,
  EXIT,
  prevPath,
  stagePath
} from './testing/installAssertions'
import { InstallSandbox, type RunResult } from './testing/installSandbox'
import {
  type BundleSpec,
  bundleFingerprint,
  NEW_BUNDLE,
  OLD_BUNDLE,
  serviceWorld,
  type WorldSpec
} from './testing/installWorld'

describe('install-sparkle-local.sh fault injection (sandboxed)', () => {
  let sandbox: InstallSandbox | undefined

  afterEach(() => {
    sandbox?.dispose()
    sandbox = undefined
  })

  const create = (spec: WorldSpec): InstallSandbox => {
    sandbox = new InstallSandbox(spec)
    return sandbox
  }

  const brokenNew = (behavior: Record<string, string>): BundleSpec => ({ ...NEW_BUNDLE, behavior })

  describe('failures before anything irreversible: the running app is never touched', () => {
    it('survives a failed staging copy (disk full)', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run({ SIM_FAIL_DITTO: '1' })
      assertExit(result, EXIT.failed)
      assert.match(result.output, /staging copy failed/)
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('cleans up a half-copied staging directory', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run({ SIM_FAIL_DITTO: 'partial' })
      assertExit(result, EXIT.failed)
      assert.equal(existsSync(stagePath(sb)), false)
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('rejects a staged bundle whose signature does not verify', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run({ SIM_VERIFY_FAIL_FOR: '.Sparkle.staging' })
      assertExit(result, EXIT.failed)
      assert.match(result.output, /staged bundle failed verification/)
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('rejects a staged bundle whose CDHash differs from the source', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run({ SIM_CDHASH_FOR: '.Sparkle.staging=deadbeef' })
      assertExit(result, EXIT.failed)
      assert.match(result.output, /CDHash mismatch/)
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('rejects a source app with an invalid signature before copying anything', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run({ SIM_VERIFY_FAIL_FOR: 'dist/mac-arm64' })
      assertExit(result, EXIT.failed)
      assert.match(result.output, /source app signature invalid/)
      assert.deepEqual(sb.callsOf('ditto'), [])
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('rejects a missing source app', async () => {
      const sb = create(serviceWorld())
      rmSync(sb.src, { recursive: true })
      const result = await sb.run()
      assertExit(result, EXIT.failed)
      assert.match(result.output, /built app missing/)
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('rejects an install when there is not enough free space', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run({ SIM_FREE_KB: '1000' })
      assertExit(result, EXIT.failed)
      assert.match(result.output, /not enough free space/)
      assert.deepEqual(sb.callsOf('ditto'), [])
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('rejects an install when the applications directory is not writable', async () => {
      const sb = create(serviceWorld())
      chmodSync(sb.apps, 0o555)
      try {
        const result = await sb.run()
        assertExit(result, EXIT.failed)
        assert.match(result.output, /cannot write to/)
        assert.deepEqual(sb.callsOf('ditto'), [])
      } finally {
        chmodSync(sb.apps, 0o755)
      }
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('refuses to proceed when a deployed worker ignores the quiet marker and cannot be refreshed', async () => {
      const sb = create(serviceWorld())
      writeFileSync(join(sb.stateDir, 'sparkle-profile-scheduler.sh'), '#!/bin/bash\nexit 0\n')
      writeFileSync(
        join(sb.repo, 'scripts', 'install-sparkle-profile-scheduler.sh'),
        '#!/bin/bash\nexit 1\n'
      )
      const result = await sb.run()
      assertExit(result, EXIT.failed)
      assert.match(result.output, /ignores the upgrade marker/)
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })

    it('refuses to proceed when launchd keeps scheduling an old worker from another plist', async () => {
      // 部署的新 worker 认标记也没用：launchd 调度的若是别处那份旧副本，定时任务照样会在安装中途碰 App。
      const sb = create(serviceWorld())
      writeFileSync(
        join(sb.simDir, 'launchd.com.sparkle.profile-scheduler'),
        '/sandbox-home/com.sparkle.profile-scheduler.plist'
      )
      const result = await sb.run({ SIM_FAIL_BOOTOUT: '1' })
      assertExit(result, EXIT.failed)
      assert.match(
        result.output,
        /launchd still schedules com\.sparkle\.profile-scheduler from \/sandbox-home\//
      )
      assert.match(result.output, /launchctl bootout gui\/\d+\/com\.sparkle\.profile-scheduler/)
      assertNothingChanged(sb, OLD_BUNDLE.version)
    })
  })

  describe('failures while quiescing', () => {
    it('restores a running app when the GUI refuses to quit even after a force kill', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run({ SIM_QUIT_REFUSES: '1', SIM_PKILL_FAILS: '1' })
      assertExit(result, EXIT.failed)
      assert.match(result.output, /still running after a force quit/)
      assertRestored(sb, OLD_BUNDLE.version)
    })

    it('force-kills a GUI that ignores the polite quit and carries on', async () => {
      const sb = create(serviceWorld())
      const result = await sb.run({ SIM_QUIT_REFUSES: '1' })
      assertExit(result, EXIT.ok)
      assert.match(result.output, /Force quitting Sparkle/)
      assertRunning(sb, NEW_BUNDLE.version)
    })
  })

  /** 失败后旧包必须是「原来那个目录」：同样的字节、同样的权限位、同一个 inode。 */
  interface Original {
    fingerprint: string
    inode: number
  }

  const snapshotOriginal = (sb: InstallSandbox): Original => ({
    fingerprint: bundleFingerprint(sb.dest),
    inode: statSync(sb.dest).ino
  })

  const assertOriginalFiles = (sb: InstallSandbox, original: Original): void => {
    assert.equal(
      bundleFingerprint(sb.dest),
      original.fingerprint,
      'old bundle must be byte-identical'
    )
    assert.equal(
      statSync(sb.dest).ino,
      original.inode,
      'the very same directory must come back, not a copy'
    )
  }

  const assertOriginalBack = (sb: InstallSandbox, original: Original): void => {
    assertRestored(sb, OLD_BUNDLE.version)
    assertOriginalFiles(sb, original)
  }

  describe('failures while swapping: the previous app is renamed straight back', () => {
    it('survives a failure of the first rename', async () => {
      const sb = create(serviceWorld())
      const original = snapshotOriginal(sb)
      const result = await sb.run({ SIM_FAIL_MV: 'mv_dest_to_prev' })
      assertExit(result, EXIT.failed)
      assert.match(result.output, /could not swap the app into place/)
      assertOriginalBack(sb, original)
    })

    it('survives a failure of the second rename, with the old app only in the backup', async () => {
      const sb = create(serviceWorld())
      const original = snapshotOriginal(sb)
      const result = await sb.run({ SIM_FAIL_MV: 'mv_stage_to_dest' })
      assertExit(result, EXIT.failed)
      assertOriginalBack(sb, original)
    })

    it('refuses to swap over a leftover backup and leaves the old app exactly where it was', async () => {
      // 备份位被别的东西占了：此刻 DEST 仍是完好的旧包，恢复逻辑绝不能把它当成「未验证的新包」丢掉。
      const sb = create(serviceWorld())
      const original = snapshotOriginal(sb)
      const run = sb.start({ SIM_HOLD_AT: 'quit' })
      await sb.waitUntilHeld()
      mkdirSync(prevPath(sb))
      writeFileSync(join(prevPath(sb), 'leftover'), 'not part of this install')
      sb.releaseHold()
      const result = await run.done
      assertExit(result, EXIT.failed)
      assert.match(result.output, /refusing to swap: a stale backup exists/)
      assertOriginalBack(sb, original)
    })
  })

  describe('a new build that fails the health gate is rolled back', () => {
    const runRejected = async (
      world: Partial<WorldSpec>,
      env: Record<string, string> = {}
    ): Promise<{ sb: InstallSandbox; result: RunResult; original: Original | null }> => {
      const sb = create(serviceWorld(world))
      const original = existsSync(sb.dest) ? snapshotOriginal(sb) : null
      const result = await sb.run(env)
      return { sb, result, original }
    }

    const cases: Array<[string, Partial<WorldSpec>, Record<string, string>, RegExp]> = [
      [
        'the proxy never starts listening',
        { next: brokenNew({ proxy: 'down' }) },
        {},
        /proxy port 7890 is not listening/
      ],
      [
        'the proxy listens but cannot reach the internet',
        { next: brokenNew({ traffic: 'fail' }) },
        {},
        /data plane/
      ],
      [
        'TUN never comes up',
        { next: brokenNew({ tun: 'absent' }) },
        {},
        /TUN: the new core has not reported/
      ],
      [
        'the app cannot be launched at all',
        { next: brokenNew({ launch: 'fails' }) },
        {},
        /is not listening/
      ],
      [
        'the old core survives and the new GUI merely attaches to it',
        {},
        { SIM_QUIT_LEAVES_CORE: '1', SIM_CORE_STOP_FAILS: '1' },
        /predates the upgrade/
      ]
    ]

    for (const [name, world, env, expected] of cases) {
      it(`rolls back when ${name}`, async () => {
        const { sb, result, original } = await runRejected(world, env)
        assertExit(result, EXIT.gateRejected)
        assert.match(result.output, expected)
        assert.match(result.output, /restoring the previous state/)
        assert.match(result.output, /previous app restored and healthy/)
        assertOriginalBack(sb, original as Original)
        assertLiveAppNeverDeleted(sb)
      })
    }

    it('does not require TUN evidence when TUN is disabled', async () => {
      const { sb, result } = await runRejected({ tun: false, next: brokenNew({ tun: 'absent' }) })
      assertExit(result, EXIT.ok)
      assert.equal(sb.destVersion(), NEW_BUNDLE.version)
    })

    it('restores an elevated-mode app with its setuid core intact', async () => {
      const { sb, result, original } = await runRejected(
        {
          mode: 'elevated',
          darwin: '24.6.0',
          old: { ...OLD_BUNDLE, coreSetuid: true },
          next: brokenNew({ proxy: 'down' })
        },
        { SIM_ELEVATION: 'grant' }
      )
      assertExit(result, EXIT.gateRejected)
      assert.equal(sb.coreSetuidBit(), true, 'the restored old core keeps its setuid bit')
      assertOriginalBack(sb, original as Original)
    })

    it('leaves a first-ever install in place when there is nothing to roll back to', async () => {
      const { sb, result } = await runRejected({ old: null, next: brokenNew({ proxy: 'down' }) })
      assertExit(result, EXIT.gateRejected)
      assert.match(result.output, /no previous app to restore/)
      assert.doesNotMatch(result.output, /restarting the previous app/)
      assert.equal(sb.destVersion(), NEW_BUNDLE.version)
      assertTransactionClosed(sb)
    })

    it('restores the files and says so when the previous app cannot be brought back up', async () => {
      const { sb, result, original } = await runRejected({
        old: { ...OLD_BUNDLE, behavior: { launch: 'fails' } },
        next: brokenNew({ proxy: 'down' })
      })
      assertExit(result, EXIT.gateRejected)
      assert.match(result.output, /previous app restored but not healthy yet/)
      assert.equal(sb.guiRunning(), false, 'this old build cannot launch, so nothing runs')
      assertOriginalFiles(sb, original as Original)
      assertTransactionClosed(sb)
      assertLiveAppNeverDeleted(sb)
    })
  })

  describe('when the rollback itself fails', () => {
    it('exits 4, keeps the evidence, and the next run finishes the recovery and the install', async () => {
      const sb = create(serviceWorld({ next: brokenNew({ proxy: 'down' }) }))
      const first = await sb.run({ SIM_FAIL_MV: 'mv_prev_to_dest' })
      assertExit(first, EXIT.rollbackFailed)
      assert.match(first.output, /CRITICAL: automatic rollback failed/)
      assert.equal(sb.hasState('upgrade-state'), true, 'phase file must survive for the next run')
      assert.equal(sb.hasState('upgrade-in-progress'), true)

      // 故障原因消除（这次新包健康）后重跑：先恢复旧包，再正常装完。
      writeFileSync(join(sb.src, 'Contents/Resources/sim-behavior'), '\n')
      const second = await sb.run()
      assertExit(second, EXIT.ok)
      assert.match(second.output, /recovery \(phase=swapped\)/)
      assertRunning(sb, NEW_BUNDLE.version)
      assertTransactionClosed(sb)
    })
  })
})
