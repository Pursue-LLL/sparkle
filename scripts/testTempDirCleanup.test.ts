// [INPUT] src/ 与 scripts/ 下全部 TypeScript 源文件（只读文本）
// [OUTPUT] （无导出，仅测试）
// [POS] 结构守卫：谁在系统临时目录里 mkdtemp，谁就必须在同一个文件里清理；
//       否则每跑一次测试就在临时目录里多留一批目录。共用的 makeTempDir 自己兜底清理，不受此限。
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCAN_DIRS = ['src', 'scripts'] as const
const SOURCE_RE = /\.[cm]?tsx?$/

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

function sourceFiles(): string[] {
  return SCAN_DIRS.flatMap((dir) =>
    readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })
      .filter((name) => SOURCE_RE.test(name) && !name.split(path.sep).includes('node_modules'))
      .map((name) => path.join(dir, name))
  )
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
    const self = path.relative(ROOT, import.meta.filename)
    const offenders = sourceFiles().filter(
      (file) => file !== self && leaksTempDir(readFileSync(path.join(ROOT, file), 'utf8'))
    )
    assert.deepEqual(offenders, [])
  })
})
