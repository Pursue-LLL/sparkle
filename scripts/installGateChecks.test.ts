import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { libShell } from './testing/libShell'

/**
 * 门禁与 App 控制库的单函数测试：用同名 shell 函数模拟进程表与内核日志，
 * 覆盖沙箱流水线里很难稳定构造的分支（进程在两次查询之间消失、日志被截断、旧 macOS）。
 */

const scratch = mkdtempSync(join(tmpdir(), 'sparkle-gate-checks-'))
const bash = libShell(scratch)
const appData = join(scratch, 'app-data')
const logs = join(appData, 'logs')
const env = { SPARKLE_APP_DATA_DIR: appData }
const NEW_CORE = `${scratch}/Sparkle.app/Contents/Resources/sidecar/mihomo`

/** 进程表：pgrep 给出 pid，ps 按字段回答可执行路径与已运行时长。 */
const processTable = (comm: string, etime: string): string => `
  pgrep() { echo 4242; }
  ps() { case "$*" in *comm=*) echo "${comm}" ;; *etime=*) echo "${etime}" ;; esac; }
`

/** 基线设在 30 秒前；`GATE_FAILURE` 一并输出，便于断言原因。 */
const judgeCore = (table: string, baseline = '$(( $(date +%s) - 30 ))'): string =>
  bash(
    `${table}\nGATE_BASELINE_EPOCH=${baseline}\ngate_core_fresh; echo "rc=$?"; echo "$GATE_FAILURE"`,
    env
  )

after(() => rmSync(scratch, { recursive: true, force: true }))

describe('gate_core_fresh', () => {
  it('refuses to judge before the upgrade baseline was recorded', () => {
    const out = judgeCore(processTable(NEW_CORE, '00:02'), '0')
    assert.match(out, /rc=1/)
    assert.match(out, /baseline was never recorded/)
  })

  it('accepts a core from the new bundle that started after the baseline', () => {
    assert.match(judgeCore(processTable(NEW_CORE, '00:02')), /rc=0/)
  })

  it('rejects a core that is older than the upgrade', () => {
    const out = judgeCore(processTable(NEW_CORE, '01:00:00'))
    assert.match(out, /rc=1/)
    assert.match(out, /predates the upgrade/)
  })

  it('rejects the case where no core is running at all', () => {
    const out = judgeCore('pgrep() { return 1; }')
    assert.match(out, /rc=1/)
    assert.match(out, /no core process from the new bundle/)
  })

  it('does not mistake a core from another bundle path for the new one', () => {
    const out = judgeCore(
      processTable('/elsewhere/Sparkle.app/Contents/Resources/sidecar/mihomo', '00:02')
    )
    assert.match(out, /rc=1/)
    assert.match(out, /no core process from the new bundle/)
  })

  it('does not count a process that vanished between the two queries', () => {
    const out = judgeCore(processTable(NEW_CORE, ''))
    assert.match(out, /rc=1/)
    assert.match(out, /no core process from the new bundle/)
  })
})

describe('gate_tun_listening_since_snapshot', () => {
  const TUN_LINE = '[TUN] Tun adapter listening at: utun8\n'
  const logPath = join(logs, 'core-2026-11-15.log')

  beforeEach(() => {
    rmSync(logs, { recursive: true, force: true })
    mkdirSync(logs, { recursive: true })
  })

  const listening = (snapshotPath: string, snapshotSize: number): boolean =>
    bash(
      `GATE_LOG_SNAPSHOT_PATH='${snapshotPath}'\nGATE_LOG_SNAPSHOT_SIZE=${snapshotSize}\ngate_tun_listening_since_snapshot; echo "rc=$?"`,
      env
    ).includes('rc=0')

  it('finds a TUN line written after the snapshot', () => {
    const before = 'earlier output\n'
    writeFileSync(logPath, before + TUN_LINE)
    assert.equal(listening(logPath, before.length), true)
  })

  it('ignores a TUN line that was already there when the snapshot was taken', () => {
    writeFileSync(logPath, TUN_LINE)
    assert.equal(listening(logPath, TUN_LINE.length), false)
  })

  it('reads a truncated log from the start instead of skipping past its end', () => {
    writeFileSync(logPath, TUN_LINE)
    assert.equal(listening(logPath, 999_999), true)
  })

  it('reads a log file that did not exist at snapshot time from the start', () => {
    // 快照大小只落在新文件内容中间：若误把别的文件的偏移套用过来，会截断 TUN 行而漏判。
    const head = 'core started\n'
    writeFileSync(logPath, head + TUN_LINE)
    assert.equal(listening(join(logs, 'core-2026-11-14.log'), head.length + 3), true)
  })

  it('is false when there is no core log at all', () => {
    assert.equal(listening('', 0), false)
  })
})

describe('app_gui_expected_to_stay', () => {
  const expectsGui = (darwin: string, config: string | null): boolean => {
    mkdirSync(appData, { recursive: true })
    rmSync(join(appData, 'config.yaml'), { force: true })
    if (config !== null) writeFileSync(join(appData, 'config.yaml'), config)
    return bash(
      `uname() { echo "${darwin}"; }\napp_gui_expected_to_stay; echo "rc=$?"`,
      env
    ).includes('rc=0')
  }

  it('always expects a GUI before macOS 26, whatever the config says', () => {
    assert.equal(expectsGui('24.6.0', null), true)
    assert.equal(expectsGui('24.6.0', 'macos26ForceGui: false\n'), true)
  })

  it('on macOS 26 only expects a GUI when the config forces it', () => {
    assert.equal(expectsGui('25.5.0', null), false)
    assert.equal(expectsGui('25.5.0', 'macos26ForceGui: false\n'), false)
    assert.equal(expectsGui('25.5.0', 'macos26ForceGui: true\n'), true)
    assert.equal(expectsGui('26.0.0', 'macos26ForceGui: true\n'), true)
  })
})
