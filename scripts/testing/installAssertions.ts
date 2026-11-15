import assert from 'node:assert/strict'
import { basename, join } from 'node:path'
import type { InstallSandbox, RunResult } from './installSandbox'

/** 退出码约定，见 install-sparkle-local.sh 头部。 */
export const EXIT = { ok: 0, failed: 1, gateRejected: 3, rollbackFailed: 4 } as const

/** 一次事务结束后的公共不变量：没有残留的暂存/备份/失败品，也没有阶段文件和静默标记。 */
export function assertTransactionClosed(sandbox: InstallSandbox): void {
  assert.deepEqual(
    sandbox.scratchEntries(),
    [],
    'scratch directories must not outlive the transaction'
  )
  assert.equal(sandbox.hasState('upgrade-state'), false, 'phase file must be cleared')
  assert.equal(sandbox.hasState('upgrade-in-progress'), false, 'quiet marker must be cleared')
}

/** 目标目录里就是 `version` 这一版，并且 App 在运行、内核来自这个目录。 */
export function assertRunning(sandbox: InstallSandbox, version: string): void {
  assert.equal(sandbox.destVersion(), version, 'installed version')
  assert.equal(sandbox.guiRunning(), true, 'GUI must be running')
  assert.equal(sandbox.coreRunning(), true, 'core must be running')
  assert.ok(
    sandbox.corePath()?.startsWith(sandbox.dest),
    'core must come from the installed bundle'
  )
  assert.equal(sandbox.proxy(), 'up', 'proxy must be listening')
}

export function assertExit(result: RunResult, code: number): void {
  assert.equal(result.code, code, `exit code (output:\n${result.output})`)
}

/** 命令桩的调用记录里是否出现过弹出管理员授权框。 */
export function elevationCalls(sandbox: InstallSandbox): string[] {
  return sandbox.callsOf('osascript').filter((line) => line.includes('administrator privileges'))
}

/** 安装器让 GUI 退出的请求（SIGTERM）。 */
export function quitCalls(sandbox: InstallSandbox): string[] {
  return sandbox.callsOf('pkill').filter((line) => !line.includes('-9'))
}

/** SIGTERM 之后仍不退出才会走的强杀（SIGKILL）。 */
export function forceKillCalls(sandbox: InstallSandbox): string[] {
  return sandbox.callsOf('pkill').filter((line) => line.includes('-9'))
}

/**
 * 任何时刻都不允许删除或覆盖正在使用的安装目标：换装只能是 rename。
 * 记录里 `rm` 的最后一个参数、`mv` 的目标参数都不得是 DEST 本身（回滚的 `mv 备份 DEST` 除外，
 * 那时 DEST 已经被挪走）。
 */
export function assertLiveAppNeverDeleted(sandbox: InstallSandbox): void {
  for (const line of sandbox.callsOf('rm')) {
    const target = line.split(' ').at(-1) ?? ''
    assert.notEqual(target, sandbox.dest, `rm must never target the live app: ${line}`)
  }
}

/** 失败发生在换装之前：旧包原样在位、仍在运行，GUI 从未被退出。 */
export function assertNothingChanged(sandbox: InstallSandbox, oldVersion: string): void {
  assertTransactionClosed(sandbox)
  assertRunning(sandbox, oldVersion)
  assert.deepEqual(
    quitCalls(sandbox),
    [],
    'the GUI must not be quit before every fallible step passed'
  )
  assert.equal(
    sandbox.callsOf('mv').some((line) => line.includes(basename(sandbox.dest))),
    false,
    'the live app must not be renamed'
  )
}

/** 回滚之后：旧包放回、已重新启动并健康，失败品已清理。 */
export function assertRestored(sandbox: InstallSandbox, oldVersion: string): void {
  assertTransactionClosed(sandbox)
  assertRunning(sandbox, oldVersion)
  assertLiveAppNeverDeleted(sandbox)
}

/** 按行序断言：`first` 一定先于 `second` 发生（都必须出现过）。 */
export function assertOrder(lines: string[], first: RegExp, second: RegExp, label: string): void {
  const a = lines.findIndex((line) => first.test(line))
  const b = lines.findIndex((line) => second.test(line))
  assert.ok(a >= 0, `${label}: missing ${first}`)
  assert.ok(b >= 0, `${label}: missing ${second}`)
  assert.ok(a < b, `${label}: ${first} must happen before ${second}`)
}

export function stagePath(sandbox: InstallSandbox): string {
  return join(sandbox.apps, '.Sparkle.staging')
}

export function prevPath(sandbox: InstallSandbox): string {
  return join(sandbox.apps, '.Sparkle.prev')
}

export function failedPath(sandbox: InstallSandbox): string {
  return join(sandbox.apps, '.Sparkle.failed')
}
