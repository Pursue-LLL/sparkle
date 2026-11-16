// [INPUT] src/ 与 scripts/ 下全部 TypeScript 源文件、scripts/ 下全部 shell 脚本（只读文本）
// [OUTPUT] （无导出，仅测试）
// [POS] 结构守卫：谁在系统临时目录里建东西，谁就必须在同一个文件里清理；
//       否则每跑一次测试或脚本就在临时目录里多留一份。共用的 makeTempDir 自己兜底清理，不受此限。
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCAN_DIRS = ['src', 'scripts'] as const
const SOURCE_RE = /\.[cm]?tsx?$/
const SHELL_RE = /\.sh$/
/** 本文件自己的测试文本里写着 mkdtemp / mktemp，不能拿自己当被检查对象。 */
const SELF = path.relative(ROOT, import.meta.filename)

/** 创建临时目录（同步或异步）。 */
const CREATES_RE = /\bmkdtemp(?:Sync)?\(/
/** 清理：rm / rmSync 的调用。 */
const REMOVES_RE = /\b(?:rm|rmSync)\(/

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function leaksTempDir(source: string): boolean {
  const code = stripComments(source)
  return CREATES_RE.test(code) && !REMOVES_RE.test(code)
}

/**
 * shell 脚本里每一行 `mktemp` 都必须赋给变量，并且同一个文件里有 `rm` 删掉这个变量；
 * 不是赋值的（内联使用）无法证明会被清理，直接算违规。只看「有没有 rm」不够：
 * 脚本里别处的 `rm -rf` 会掩盖一个没人删的临时目录。
 */
function leaksShellTempPath(source: string): boolean {
  const lines = source.split('\n').filter((line) => !/^\s*#/.test(line))
  const code = lines.join('\n')
  return lines.some((line) => {
    if (!/\bmktemp\b/.test(line)) return false
    const variable = /^\s*(?:local\s+|export\s+)?([A-Za-z_]\w*)=/.exec(line)?.[1]
    if (!variable) return true
    return !new RegExp(`\\brm\\s+-\\w+\\s+"?\\$\\{?${variable}\\b`).test(code)
  })
}

function filesUnder(pattern: RegExp, dirs: readonly string[] = SCAN_DIRS): string[] {
  return dirs.flatMap((dir) =>
    readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })
      .filter((name) => pattern.test(name) && !name.split(path.sep).includes('node_modules'))
      .map((name) => path.join(dir, name))
  )
}

function offendersAmong(files: string[], leaks: (source: string) => boolean): string[] {
  return files.filter((file) => file !== SELF && leaks(readFileSync(path.join(ROOT, file), 'utf8')))
}

describe('temp dir cleanup guard', () => {
  it('flags a file that creates temp dirs and never removes them', () => {
    assert.equal(leaksTempDir('const d = mkdtempSync(path.join(tmpdir(), "x-"))'), true)
    assert.equal(leaksTempDir('const d = await mkdtemp(path.join(tmpdir(), "x-"))'), true)
  })

  it('accepts a file that removes what it creates, or only uses the shared helper', () => {
    assert.equal(leaksTempDir('const d = mkdtempSync(p)\nrmSync(d, { recursive: true })'), false)
    assert.equal(leaksTempDir('const d = await mkdtemp(p)\nawait rm(d, { force: true })'), false)
    assert.equal(leaksTempDir('const d = makeTempDir("x-")'), false)
  })

  it('does not take a comment or an import for a creation or a removal', () => {
    assert.equal(leaksTempDir('// mkdtempSync(p) is not called here\nconst a = 1'), false)
    assert.equal(leaksTempDir('/* rmSync(d) */\nconst d = mkdtempSync(p)'), true)
    assert.equal(
      leaksTempDir("import { mkdtemp, rm } from 'fs/promises'\nconst d = mkdtemp(p)"),
      true
    )
  })

  it('leaves no source file under src/ or scripts/ that creates temp dirs without removing them', () => {
    assert.deepEqual(offendersAmong(filesUnder(SOURCE_RE), leaksTempDir), [])
  })
})

describe('shell temp path cleanup guard', () => {
  it('flags a mktemp result that nothing removes, even when the script removes other things', () => {
    assert.equal(leaksShellTempPath('d="$(mktemp -d)"'), true)
    assert.equal(
      leaksShellTempPath(`wrap_dir="\${SHIM:-$(mktemp -d)}"\nrm -rf "$LOCK_DIR"`),
      true,
      'an unrelated rm must not hide a temp dir nobody removes'
    )
    assert.equal(leaksShellTempPath('cd "$(mktemp -d)"\nrm -rf "$d"'), true)
  })

  it('accepts a mktemp result that is removed by name, in a trap or inline', () => {
    assert.equal(leaksShellTempPath('d="$(mktemp -d)"\ntrap \'rm -rf "$d"\' EXIT'), false)
    assert.equal(
      leaksShellTempPath('  local out\n  out="$(mktemp f.XXXXXX)"\n  rm -f "$out"'),
      false
    )
    assert.equal(leaksShellTempPath(`SHIM="$(mktemp -d)"\nrm -rf "\${SHIM}"`), false)
  })

  it('does not take a comment for a creation', () => {
    assert.equal(leaksShellTempPath('# the old code ran mktemp -d here\necho ok'), false)
  })

  it('leaves no script under scripts/ whose mktemp result is never removed', () => {
    assert.deepEqual(offendersAmong(filesUnder(SHELL_RE, ['scripts']), leaksShellTempPath), [])
  })
})
