import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  assertExit,
  assertRestored,
  assertRunning,
  assertTransactionClosed,
  EXIT,
  failedPath,
  prevPath,
  stagePath
} from './testing/installAssertions'
import { InstallSandbox, NEW_BUNDLE, OLD_BUNDLE, serviceWorld } from './testing/installSandbox'

interface DiskState {
  phase: string | null
  dest: string | null
  prev: boolean
  stage: boolean
  failed: boolean
}

/** kill -9 之后磁盘上留下的东西：这就是下一次启动要面对的全部现场。 */
function diskState(sandbox: InstallSandbox): DiskState {
  return {
    phase: sandbox.phase(),
    dest: sandbox.destVersion(),
    prev: existsSync(prevPath(sandbox)),
    stage: existsSync(stagePath(sandbox)),
    failed: existsSync(failedPath(sandbox))
  }
}

const OLD = OLD_BUNDLE.version
const NEW = NEW_BUNDLE.version

/** 每个崩溃点的现场，以及恢复之后应当停在哪一边（提交前回旧包，提交后保留新包）。 */
const CRASH_POINTS: ReadonlyArray<{ point: string; disk: DiskState; settlesOn: 'old' | 'new' }> = [
  {
    point: 'ditto',
    disk: { phase: 'staging', dest: OLD, prev: false, stage: true, failed: false },
    settlesOn: 'old'
  },
  {
    point: 'quit',
    disk: { phase: 'quiesced', dest: OLD, prev: false, stage: true, failed: false },
    settlesOn: 'old'
  },
  {
    point: 'mv_dest_to_prev',
    disk: { phase: 'swapping', dest: null, prev: true, stage: true, failed: false },
    settlesOn: 'old'
  },
  {
    point: 'mv_stage_to_dest',
    disk: { phase: 'swapping', dest: NEW, prev: true, stage: false, failed: false },
    settlesOn: 'old'
  },
  {
    point: 'launch',
    disk: { phase: 'swapped', dest: NEW, prev: true, stage: false, failed: false },
    settlesOn: 'old'
  },
  {
    point: 'rm_prev_before',
    disk: { phase: 'committed', dest: NEW, prev: true, stage: false, failed: false },
    settlesOn: 'new'
  },
  {
    point: 'rm_prev_after',
    disk: { phase: 'committed', dest: NEW, prev: false, stage: false, failed: false },
    settlesOn: 'new'
  }
]

describe('install-sparkle-local.sh crash recovery (sandboxed)', () => {
  let sandbox: InstallSandbox | undefined
  const strays: Array<{ kill: () => boolean }> = []

  afterEach(() => {
    for (const stray of strays.splice(0)) stray.kill()
    sandbox?.dispose()
    sandbox = undefined
  })

  const create = (): InstallSandbox => {
    sandbox = new InstallSandbox(serviceWorld())
    return sandbox
  }

  describe('kill -9 at every step of the transaction', () => {
    for (const { point, disk, settlesOn } of CRASH_POINTS) {
      it(`leaves a recoverable state after a hard kill at "${point}"`, async () => {
        const sb = create()
        const crashed = await sb.run({ SIM_KILL_AT: point })
        assert.equal(crashed.signal, 'SIGKILL', `the installer must have been killed at ${point}`)
        assert.deepEqual(diskState(sb), disk, 'on-disk state right after the crash')
        assert.equal(
          sb.hasState('upgrade-in-progress'),
          true,
          'the quiet marker keeps background tasks away'
        )

        // 恢复不依赖新包：源包坏掉的这一次仍要先把现场收拾到「一边完整」，再报告源包问题。
        const recovery = await sb.run({ SIM_VERIFY_FAIL_FOR: 'dist/mac-arm64' })
        assertExit(recovery, EXIT.failed)
        assert.match(recovery.output, /source app signature invalid/)
        if (settlesOn === 'old') {
          assertRestored(sb, OLD)
        } else {
          assertTransactionClosed(sb)
          assertRunning(sb, NEW)
        }

        // 收拾完之后系统是干净的：下一次正常安装直接成功。
        const next = await sb.run()
        assertExit(next, EXIT.ok)
        assertTransactionClosed(sb)
        assertRunning(sb, NEW)
      })
    }
  })

  describe('a second crash in the middle of the rollback itself', () => {
    const MID_ROLLBACK = [
      {
        point: 'mv_dest_to_failed',
        disk: { phase: 'swapped', dest: null, prev: true, stage: false, failed: true }
      },
      {
        point: 'mv_prev_to_dest',
        disk: { phase: 'swapped', dest: OLD, prev: false, stage: false, failed: true }
      }
    ]
    for (const { point, disk } of MID_ROLLBACK) {
      it(`converges after a kill at "${point}"`, async () => {
        const sb = create()
        const first = await sb.run({ SIM_KILL_AT: 'launch' })
        assert.equal(first.signal, 'SIGKILL')
        const second = await sb.run({ SIM_KILL_AT: point })
        assert.equal(second.signal, 'SIGKILL', `the rollback must have been killed at ${point}`)
        assert.deepEqual(diskState(sb), disk, 'on-disk state after the interrupted rollback')

        const third = await sb.run()
        assertExit(third, EXIT.ok)
        assertTransactionClosed(sb)
        assertRunning(sb, NEW)
      })
    }
  })

  describe('termination signals', () => {
    const CASES = [
      { signal: 'SIGTERM', hold: 'launch', code: 130, wholeGroup: false },
      { signal: 'SIGINT', hold: 'launch', code: 130, wholeGroup: true },
      { signal: 'SIGHUP', hold: 'quit', code: 129, wholeGroup: false }
    ] as const
    for (const { signal, hold, code, wholeGroup } of CASES) {
      it(`${signal} while waiting on "${hold}" rolls back and exits ${code}`, async () => {
        const sb = create()
        const run = sb.start({ SIM_HOLD_AT: hold })
        await sb.waitUntilHeld()
        assert.equal(
          sb.hasState('upgrade-state'),
          true,
          'the transaction is open at the hold point'
        )
        // Ctrl-C 发给整个前台进程组；其它信号只发给安装脚本本身。
        process.kill(wholeGroup ? -run.pid : run.pid, signal)
        sb.releaseHold()
        const result = await run.done
        assertExit(result, code)
        assert.match(result.output, /restoring the previous state/)
        assert.match(result.output, /previous state restored/)
        assertRestored(sb, OLD)
      })
    }
  })

  describe('only one installer at a time', () => {
    it('refuses a second installer without touching the first one or its log', async () => {
      const sb = create()
      const first = sb.start({ SIM_HOLD_AT: 'launch' })
      await sb.waitUntilHeld()
      const before = diskState(sb)
      const logBefore = sb.installLog()

      const second = await sb.run()
      assertExit(second, EXIT.failed)
      assert.match(second.output, /another install is in progress/)
      assert.deepEqual(diskState(sb), before, 'the refused run must not touch the transaction')
      assert.equal(
        sb.installLog(),
        logBefore,
        'the refused run must not rotate or write the running log'
      )

      sb.releaseHold()
      const result = await first.done
      assertExit(result, EXIT.ok)
      assertTransactionClosed(sb)
      assertRunning(sb, NEW)
    })

    /** 写一份「由 pid 声称正在运行」的阶段文件。 */
    const claimPhase = (sb: InstallSandbox, pid: number, ageMinutes = 0): void => {
      const file = join(sb.stateDir, 'upgrade-state')
      writeFileSync(
        file,
        `phase=staging\npid=${pid}\nts=${Math.floor(Date.now() / 1000)}\nhad_prev=1\n`
      )
      const stamp = new Date(Date.now() - ageMinutes * 60_000)
      utimesSync(file, stamp, stamp)
    }

    const spawnStray = (command: string, args: string[]): number => {
      const child = spawn(command, args, { stdio: 'ignore' })
      strays.push(child)
      return child.pid ?? 0
    }

    it('refuses while a live bash process owns a fresh phase file', async () => {
      const sb = create()
      claimPhase(sb, spawnStray('/bin/bash', ['-c', 'sleep 60; true']))
      const result = await sb.run()
      assertExit(result, EXIT.failed)
      assert.match(result.output, /another install is in progress/)
      assert.equal(sb.hasState('upgrade-state'), true, 'the owner is alive, its state must stay')
      assert.deepEqual(sb.callsOf('ditto'), [])
    })

    it('ignores a phase file whose pid was reused by an unrelated program', async () => {
      const sb = create()
      claimPhase(sb, spawnStray('/bin/sleep', ['60']))
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assert.doesNotMatch(result.output, /another install is in progress/)
      assertTransactionClosed(sb)
      assertRunning(sb, NEW)
    })

    it('ignores a phase file that is older than an hour even if its pid is a live bash', async () => {
      const sb = create()
      claimPhase(sb, spawnStray('/bin/bash', ['-c', 'sleep 60; true']), 120)
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assertTransactionClosed(sb)
      assertRunning(sb, NEW)
    })

    it('ignores a phase file whose owner is dead', async () => {
      const sb = create()
      claimPhase(sb, 2_147_483_000)
      const result = await sb.run()
      assertExit(result, EXIT.ok)
      assertTransactionClosed(sb)
      assertRunning(sb, NEW)
    })
  })
})
