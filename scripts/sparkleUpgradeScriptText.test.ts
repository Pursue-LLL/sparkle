import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

/**
 * 安装/构建路径上出现 `tsx -e "<script>" "$arg"` 会把 `$arg` 交给 node 当命令行选项
 * （实测 `bad option: -rwxr-xr-x`），让一个「检查」变成「脚本中途崩溃」——
 * 而崩溃发生在已经 quit 掉 App 之后，用户看到的是「App 关了就再没起来」。
 * 这里把该失败模式固化成回归护栏：升级链路上的脚本不得再用 `tsx -e` 传参。
 */
const UPGRADE_PATH_SCRIPTS = [
  'install-sparkle-local.sh',
  'upgrade-sparkle-local.sh',
  'agent-sparkle-upgrade.sh',
  'install-sparkle-gui-watchdog.sh',
  'lib/core-setuid.sh',
] as const

const SCRIPTS_DIR = join(import.meta.dirname)

function readScript(name: string): string {
  return readFileSync(join(SCRIPTS_DIR, name), 'utf8')
}

describe('install path safety', () => {
  it('never feeds a dash-leading value to `tsx -e` (node parses it as an option)', () => {
    // 实测：`tsx -e "..." "普通值"` 可正常工作（argv 正确），但参数以 `-` 开头时
    // node 会当成命令行选项并直接退出（`bad option: -rwxr-xr-x`）。
    // 权限位 `-rwxr-xr-x` 正是这种值，因此判定 setuid 一律用纯 bash，不进 tsx。
    for (const name of UPGRADE_PATH_SCRIPTS) {
      const text = readScript(name)
      assert.equal(
        /\.bin\/tsx"\s+-e\s+"[\s\S]*?"\s+"-[A-Za-z]/.test(text),
        false,
        `${name} passes a dash-leading value to tsx -e`
      )
    }
  })

  it('keeps the setuid judgement in a sourced pure-bash library', () => {
    const lib = readScript('lib/core-setuid.sh')
    assert.match(lib, /^is_setuid_mode\(\)/m, 'setuid helper must exist')
    assert.match(lib, /mode:3:1/, 'setuid helper must inspect the owner execute bit')
    // source 库本身不得带任何顶层副作用（只定义函数与常量）。
    assert.equal(/^set -[eux]/m.test(lib), false, 'the library must not flip shell options')
    assert.equal(/^exit\b/m.test(lib), false, 'the library must not exit the caller')

    const installer = readScript('install-sparkle-local.sh')
    assert.match(installer, /source "\$ROOT\/scripts\/lib\/core-setuid\.sh"/)
    assert.match(
      installer,
      /restore_core_setuid "\$DEST" \|\| fail/,
      'install must abort when setuid cannot be restored'
    )
  })

  it('only ever elevates for the core that is actually enabled', () => {
    const lib = readScript('lib/core-setuid.sh')
    // 给未启用的内核提权等于凭空多要一次密码。
    assert.match(lib, /enabled_core_name/)
    assert.match(lib, /config\.yaml/)
    assert.match(lib, /mihomo-alpha/)
  })

  it('does not relaunch the app by default when post-install bootstrap fails', () => {
    const text = readScript('upgrade-sparkle-local.sh')
    assert.match(
      text,
      /SPARKLE_POST_INSTALL_RECOVERY_MAX_ROUNDS:-0\}/,
      'recovery rounds must default to 0 so a failure stops instead of rebooting the app'
    )
  })

  it('short-circuits before quitting the app', () => {
    const text = readScript('install-sparkle-local.sh')
    const shortCircuitAt = text.indexOf('Same build already installed and healthy')
    const quitAt = text.indexOf('Quitting Sparkle GUI')
    assert.ok(shortCircuitAt > 0, 'short-circuit branch must exist')
    assert.ok(quitAt > 0, 'quit step must exist')
    assert.ok(
      shortCircuitAt < quitAt,
      'the short-circuit must be decided before the app is quit'
    )
  })

  it('serializes upgrades with an atomic directory lock on both entry points', () => {
    for (const name of ['agent-sparkle-upgrade.sh', 'upgrade-sparkle-local.sh']) {
      const text = readScript(name)
      assert.match(text, /mkdir "\$[A-Z_]*LOCK_DIR"/, `${name} must take an atomic mkdir lock`)
      assert.match(text, /trap /, `${name} must release the lock on exit`)
    }
  })
})
