// [INPUT] docDriftIndex::isFixturePath/isTestPath (POS: 文档漂移守护的数据模型与源码索引，规则层只和内存快照打交道) ·
//         testing/tempDirs::makeTempDir (POS: 脚本测试共用的临时目录，退出时自动删除) ·
//         docDriftCli.mts（被测的命令行入口，经 tsx 子进程运行）· agent-sparkle-upgrade.sh（被测的升级入口，复制进临时目录运行）
// [OUTPUT] （无导出，仅测试）
// [POS] 装包前文档门禁的出口测试：在临时目录的迷你仓库（复制守护的生产代码）里真实运行命令行入口——一致时退出 0、
//       有漂移列明并退出 1、缺根文档也拦；再把真实的升级入口脚本复制进去，用桩替换其余步骤，验证漂移时在任何其他步骤之前
//       拒绝升级、一致时放行到下一步。沙箱里没有安装脚本也碰不到 /Applications，不可能装任何东西。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { makeTempDir } from '../testing/tempDirs'
import { isFixturePath, isTestPath } from './docDriftIndex'

const ROOT = path.resolve(import.meta.dirname, '../..')
const GUARD_DIR = path.join(ROOT, 'scripts/docDrift')
const AGENT_SCRIPT = path.join(ROOT, 'scripts/agent-sparkle-upgrade.sh')
const TSX = path.join(ROOT, 'node_modules/.bin/tsx')

/** 守护的生产代码（含命令行入口）；测试与夹具不进迷你仓库。 */
const GUARD_FILES = readdirSync(GUARD_DIR).filter(
  (name) => !isTestPath(name) && !isFixturePath(name)
)

const CONSISTENT_ROOT_DOC = '# root\n'
const DRIFTED_ROOT_DOC = '# root\n\n模块清单见 `ghostModule.ts`。\n'

/**
 * 迷你仓库：守护的生产代码、`package.json`，以及传入的根文档（null 表示没有）。
 * `scripts/package.json` 也要带上：它把 `scripts/` 下的 `.ts` 声明成 ESM，少了它 `.mts` 入口导入不了同目录的 `.ts`。
 */
function createRepo(rootDoc: string | null): string {
  const root = makeTempDir('doc-drift-gate-')
  const guardDir = path.join(root, 'scripts/docDrift')
  mkdirSync(guardDir, { recursive: true })
  copyFileSync(path.join(ROOT, 'scripts/package.json'), path.join(root, 'scripts/package.json'))
  for (const name of GUARD_FILES) {
    copyFileSync(path.join(GUARD_DIR, name), path.join(guardDir, name))
  }
  writeFileSync(path.join(root, 'package.json'), '{"version":"0.0.0"}')
  if (rootDoc !== null) writeFileSync(path.join(root, 'ARCHITECTURE.md'), rootDoc)
  return root
}

function runCli(root: string) {
  return spawnSync(TSX, [path.join(root, 'scripts/docDrift/docDriftCli.mts')], {
    cwd: root,
    encoding: 'utf8'
  })
}

describe('docDriftCli.mts', () => {
  it('prints a one-line verdict and exits 0 when the docs match the code', () => {
    const result = runCli(createRepo(CONSISTENT_ROOT_DOC))
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /文档与代码一致（核对了 1 份文档、\d+ 个源码文件）/)
  })

  it('lists every drift on stderr and exits 1', () => {
    const result = runCli(createRepo(DRIFTED_ROOT_DOC))
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /共 1 处/)
    assert.match(result.stderr, /ARCHITECTURE\.md:3 \[doc-file-missing\] .*ghostModule\.ts/)
    assert.doesNotMatch(result.stdout, /文档与代码一致/)
  })

  it('fails instead of reporting success when the root ARCHITECTURE.md is missing', () => {
    const result = runCli(createRepo(null))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /ARCHITECTURE\.md/)
    assert.doesNotMatch(result.stdout, /文档与代码一致/)
  })
})

/** 沙箱里的 tsx：只放行文档门禁，其余步骤（装前清理、构建、安装……）记一笔就失败。 */
const TSX_STUB = `#!/bin/bash
case "$1" in
  */docDriftCli.mts) exec "$REAL_TSX" "$@" ;;
  *) echo "$1" >> "$CALLS_LOG"; exit 99 ;;
esac
`

/** 在迷你仓库里跑真实的升级入口脚本；`calls` 是门禁之后它还去调用了哪些 tsx 脚本。 */
function runAgentUpgrade(root: string) {
  const callsLog = path.join(root, 'calls.log')
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true })
  writeFileSync(path.join(root, 'node_modules/.bin/tsx'), TSX_STUB, { mode: 0o755 })
  const script = path.join(root, 'scripts/agent-sparkle-upgrade.sh')
  copyFileSync(AGENT_SCRIPT, script)
  const result = spawnSync('/bin/bash', [script], {
    cwd: root,
    encoding: 'utf8',
    // 环境全部指向沙箱：HOME、TMPDIR 与入口锁都不碰真实系统。
    env: {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: root,
      TMPDIR: root,
      SPARKLE_UPGRADE_ENTRY_LOCK_DIR: path.join(root, 'entry.lock'),
      REAL_TSX: TSX,
      CALLS_LOG: callsLog
    }
  })
  const calls = existsSync(callsLog) ? readFileSync(callsLog, 'utf8').trim().split('\n') : []
  return { ...result, calls }
}

describe('agent-sparkle-upgrade.sh docs gate', () => {
  it('refuses to upgrade while the docs drift from the code, before any other step runs', () => {
    const result = runAgentUpgrade(createRepo(DRIFTED_ROOT_DOC))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /\[doc-file-missing\]/)
    assert.match(result.stderr, /FAIL: docs drift/)
    assert.deepEqual(result.calls, [], '门禁拒绝之后不该再有任何步骤')
  })

  it('lets the upgrade go on to its next step when the docs match the code', () => {
    const result = runAgentUpgrade(createRepo(CONSISTENT_ROOT_DOC))
    assert.match(result.stdout, /文档与代码一致/)
    assert.match(
      result.stderr,
      /Remote sync: .*skipped/,
      '迷你仓库不是 git 仓库：提示跑了，且只是跳过'
    )
    assert.ok(result.calls.length > 0, '门禁放行之后升级应当继续走下一步')
  })
})
