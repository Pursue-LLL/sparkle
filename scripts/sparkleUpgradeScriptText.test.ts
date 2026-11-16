import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

/**
 * 升级链路的结构性护栏：行为由沙箱测试（installPipeline / installFaultInjection / installCrashRecovery）
 * 实际执行来证明；这里守住那些「执行测试覆盖不到、但一改就会失效」的结构约束——
 * 不可逆动作的先后顺序、能删东西的代码范围、被吞掉的错误输出、bash 3.2 兼容性等。
 */

const SCRIPTS_DIR = join(import.meta.dirname)

const LIBRARIES = readdirSync(join(SCRIPTS_DIR, 'lib'))
  .filter((name) => name.endsWith('.sh'))
  .map((name) => `lib/${name}`)
  .sort()

const UPGRADE_PATH_SCRIPTS = [
  'install-sparkle-local.sh',
  'upgrade-sparkle-local.sh',
  'agent-sparkle-upgrade.sh',
  'install-sparkle-gui-watchdog.sh',
  'install-sparkle-profile-scheduler.sh',
  'sparkle-gui-watchdog.sh',
  'sparkle-profile-scheduler.sh',
  ...LIBRARIES
]

function readScript(name: string): string {
  return readFileSync(join(SCRIPTS_DIR, name), 'utf8')
}

/** 去掉整行注释：注释里提到被禁用的写法（说明为什么不用）不算违规。 */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
}

/** scripts 目录（含子目录）下除测试外的全部脚本源文件。 */
function nonTestScriptFiles(): string[] {
  return readdirSync(SCRIPTS_DIR, { recursive: true, encoding: 'utf8' }).filter(
    (name) => /\.(sh|mts|ts)$/.test(name) && !name.endsWith('.test.ts')
  )
}

/** 取一个顶格定义的 shell 函数的完整函数体。 */
function functionBody(text: string, name: string): string {
  const match = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm').exec(text)
  assert.ok(match, `function ${name}() not found`)
  return match[0]
}

describe('install path safety', () => {
  it('never feeds a dash-leading value to `tsx -e` (node parses it as an option)', () => {
    // `tsx -e "..." "普通值"` 可正常工作，但参数以 `-` 开头时 node 会当成命令行选项
    // 并直接退出（`bad option: -rwxr-xr-x`）。权限位正是这种值，所以判定 setuid 一律用纯 bash。
    for (const name of UPGRADE_PATH_SCRIPTS) {
      assert.equal(
        /\.bin\/tsx"\s+-e\s+"[\s\S]*?"\s+"-[A-Za-z]/.test(readScript(name)),
        false,
        `${name} passes a dash-leading value to tsx -e`
      )
    }
  })

  it('parses under the system bash (macOS ships 3.2)', () => {
    for (const name of UPGRADE_PATH_SCRIPTS) {
      assert.doesNotThrow(
        () => execFileSync('/bin/bash', ['-n', join(SCRIPTS_DIR, name)], { stdio: 'pipe' }),
        `${name} does not parse`
      )
    }
  })

  it('uses no construct that only exists in bash 4+ (the sandbox suites run bash 3.2, but error branches rarely run)', () => {
    const bash4Only: ReadonlyArray<readonly [RegExp, string]> = [
      [/\bdeclare\s+-A\b/, 'associative arrays'],
      [/\b(mapfile|readarray)\b/, 'mapfile/readarray'],
      [/\$\{[A-Za-z_][A-Za-z0-9_]*(,,|\^\^|,|\^)\}/, 'case-modifying expansion'],
      [/&>>/, '&>>'],
      [/\|&/, '|&'],
      [/\bcoproc\b/, 'coproc'],
      [/\[\[\s+-v\s/, '[[ -v ]]']
    ]
    for (const name of UPGRADE_PATH_SCRIPTS) {
      const text = code(readScript(name))
      for (const [pattern, label] of bash4Only) {
        assert.equal(pattern.test(text), false, `${name} uses ${label}`)
      }
    }
  })

  it('keeps sourced libraries free of top-level side effects', () => {
    for (const name of LIBRARIES) {
      const text = code(readScript(name))
      assert.equal(
        /^set -[eux]/m.test(text),
        false,
        `${name} must not flip the caller's shell options`
      )
      assert.equal(/^exit\b/m.test(text), false, `${name} must not exit the caller`)
      assert.equal(/^trap\b/m.test(text), false, `${name} must not install traps`)
    }
  })

  it('keeps the setuid judgement in a pure-bash library and prepares it on the staged copy', () => {
    const lib = readScript('lib/core-setuid.sh')
    assert.match(lib, /^is_setuid_mode\(\)/m, 'setuid helper must exist')
    assert.match(lib, /mode:3:1/, 'setuid helper must inspect the owner execute bit')

    const installer = readScript('install-sparkle-local.sh')
    assert.match(installer, /source "\$ROOT\/scripts\/lib\/install-transaction\.sh"/)
    assert.match(
      functionBody(installer, 'stage_new_bundle'),
      /restore_core_setuid "\$TXN_STAGE" \|\| fail/,
      'the permission step must run on the staged copy, before anything is swapped, and abort the install on failure'
    )
  })

  it('only ever elevates for the core that is actually enabled', () => {
    const lib = readScript('lib/core-setuid.sh')
    // 给未启用的内核提权等于凭空多要一次密码。
    assert.match(lib, /enabled_core_name/)
    assert.match(lib, /config\.yaml/)
    assert.match(lib, /mihomo-alpha/)
  })

  it('never discards the error output of a privileged command', () => {
    // 用户取消授权、被策略拒绝等原因只出现在特权命令的 stderr 里，吞掉就只能靠猜。
    for (const name of UPGRADE_PATH_SCRIPTS) {
      const privileged = code(readScript(name))
        .split('\n')
        .filter((line) => line.includes('administrator privileges'))
      for (const line of privileged) {
        assert.equal(line.includes('2>/dev/null'), false, `${name}: ${line.trim()}`)
      }
    }
  })

  it('stops on the spot when post-install bootstrap fails instead of restarting the app to retry', () => {
    assert.match(
      code(readScript('upgrade-sparkle-local.sh')),
      /\[\[ "\$bootstrap_state" == "ok" \]\] \|\| fail "PostCoreBootstrap not ready/,
      'a bootstrap that never became ready must abort the upgrade and leave the evidence in place'
    )
    // 自动重启重试要么被退出确认框拦住而无效，要么把「装一次」变成反复启停，所以不留任何入口。
    for (const name of nonTestScriptFiles()) {
      assert.equal(
        /post-install-recovery/.test(name),
        false,
        `${name} is a post-install restart helper`
      )
      assert.doesNotMatch(
        code(readScript(name)),
        /POST_INSTALL_RECOVERY/,
        `${name} re-adds automatic post-install restart rounds`
      )
    }
  })

  it('never restarts the root service from a script (the daemon would be restarting itself mid-request)', () => {
    const forbidden = new RegExp(`/service/${'restart'}`)
    const files = nonTestScriptFiles()
    assert.ok(files.length > 20, 'the scan must actually cover the scripts directory')
    for (const name of files) {
      assert.equal(forbidden.test(readScript(name)), false, `${name} restarts the service`)
    }
  })
})

describe('install transaction structure', () => {
  const installer = readScript('install-sparkle-local.sh')

  it('runs the phases in the order that keeps every fallible step before the first irreversible one', () => {
    const main = functionBody(installer, 'main')
    const order = [
      'txn_refuse_if_other_installer',
      'install_log_init',
      'txn_rollback',
      'validate_source',
      'gate_probe_baseline',
      'short_circuit_if_healthy',
      'ensure_background_workers',
      'preflight_checks',
      'stage_new_bundle',
      'quiesce',
      'swap',
      'launch_and_gate',
      'txn_commit',
      'post_commit'
    ]
    const positions = order.map((step) => main.search(new RegExp(`\\b${step}\\b`)))
    positions.forEach((position, index) =>
      assert.ok(position >= 0, `main() never calls ${order[index]}`)
    )
    assert.deepEqual(
      [...positions].sort((a, b) => a - b),
      positions,
      `main() must call these in this order: ${order.join(' → ')}`
    )
  })

  it('does not quit the app, stop the core, or swap anything before the quiesce phase', () => {
    const disruptive = /app_quit_gui|service_core_stop|txn_swap_in|pkill|launchctl|app_launch/
    for (const step of [
      'validate_source',
      'short_circuit_if_healthy',
      'ensure_background_workers',
      'preflight_checks',
      'stage_new_bundle'
    ]) {
      assert.equal(
        disruptive.test(code(functionBody(installer, step))),
        false,
        `${step}() is disruptive`
      )
    }
    assert.match(functionBody(installer, 'quiesce'), /app_quit_gui/)
    assert.match(functionBody(installer, 'swap'), /txn_swap_in/)
  })

  it('decides the idempotent short-circuit before anything is staged, quit or swapped', () => {
    const main = functionBody(installer, 'main')
    assert.ok(main.indexOf('short_circuit_if_healthy') < main.indexOf('stage_new_bundle'))
    assert.match(
      functionBody(installer, 'short_circuit_if_healthy'),
      /Same build already installed and healthy/
    )
  })

  it('cleans up on every way out: normal exit, Ctrl-C, SIGTERM and SIGHUP', () => {
    assert.match(installer, /trap on_exit EXIT/)
    assert.match(installer, /trap 'exit 130' INT TERM/)
    assert.match(installer, /trap 'exit 129' HUP/)
  })

  it('can only delete the three transaction directories, never the installed app', () => {
    const deleting = [...LIBRARIES, 'install-sparkle-local.sh'].flatMap((name) =>
      code(readScript(name))
        .split('\n')
        .filter((line) => /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*)\b/.test(line))
        .map((line) => ({ name, line: line.trim() }))
    )
    assert.deepEqual(deleting, [{ name: 'lib/install-transaction.sh', line: 'rm -rf "$target"' }])
    assert.match(
      functionBody(readScript('lib/install-transaction.sh'), 'txn_remove_scratch'),
      /rm -rf "\$target"/
    )
  })

  it('owns the background workers: refreshes both before touching the app and refuses stale ones', () => {
    const body = functionBody(installer, 'ensure_background_workers')
    assert.match(body, /install-sparkle-profile-scheduler\.sh/)
    assert.match(body, /install-sparkle-gui-watchdog\.sh/)
    assert.match(body, /grep -qF 'upgrade-in-progress'/)
    assert.match(body, /fail "background worker/)
  })

  it('leaves worker installation to the installer instead of repeating it in the entry script', () => {
    assert.doesNotMatch(
      code(readScript('agent-sparkle-upgrade.sh')),
      /install-sparkle-(profile-scheduler|gui-watchdog)/
    )
  })

  it('serializes upgrades with an atomic directory lock on both entry points', () => {
    for (const name of ['agent-sparkle-upgrade.sh', 'upgrade-sparkle-local.sh']) {
      const text = readScript(name)
      assert.match(text, /mkdir "\$[A-Z_]*LOCK_DIR"/, `${name} must take an atomic mkdir lock`)
      assert.match(text, /trap /, `${name} must release the lock on exit`)
    }
  })

  it('removes the pnpm shim directory it creates on every way out of the script', () => {
    const script = readScript('upgrade-sparkle-local.sh')
    assert.match(code(script), /PNPM_SHIM_DIR="\$\(mktemp -d /)
    assert.match(functionBody(script, 'cleanup_on_exit'), /rm -rf "\$PNPM_SHIM_DIR"/)
    assert.match(script, /trap 'cleanup_on_exit' EXIT/)
    assert.match(functionBody(script, 'handle_upgrade_signal'), /cleanup_on_exit/)
  })
})
