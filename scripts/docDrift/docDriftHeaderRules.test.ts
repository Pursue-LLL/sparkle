// [INPUT] docDriftRig::snapshotOf/headerOf/findingsOf/rulesOf (POS: 文档漂移守护各测试共用的夹具，用几行字符串拼内存快照)
// [OUTPUT] （无导出，仅测试）
// [POS] 文件头规则的正反例：段落齐全、OUTPUT 点名的导出真实存在、INPUT 点名的模块与符号真实存在，
//       以及哪些写法不在判定范围内（没有标签的文件、自由写法的 INPUT、npm 依赖、歧义的模块名）。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findingsOf, headerOf, rulesOf, snapshotOf } from './docDriftRig'

const complete = (input: string, output: string, body: string): string =>
  `${headerOf({ input, output, pos: '说明' })}\n${body}\n`

describe('header completeness', () => {
  it('passes a complete header whose names all exist', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/a/alpha.ts': complete('beta::bar (POS: 乙)', 'foo', 'export const foo = 1'),
        'src/a/beta.ts': complete('无', 'bar', 'export function bar() {}')
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('names the missing tag, anchored at the first tag line', () => {
    const snapshot = snapshotOf({
      sources: { 'src/a.ts': '// [INPUT] 无\n// [POS] 说明\nexport const a = 1\n' }
    })
    assert.deepEqual(findingsOf(snapshot), ['src/a.ts:1 [header-incomplete] 文件头缺 [OUTPUT]'])
  })

  it('reports an empty tag on its own line', () => {
    const snapshot = snapshotOf({
      sources: { 'src/a.ts': '// [INPUT] 无\n// [OUTPUT]\n// [POS] 说明\nexport const a = 1\n' }
    })
    assert.deepEqual(findingsOf(snapshot), [
      'src/a.ts:2 [header-incomplete] 文件头的 [OUTPUT] 是空的'
    ])
  })

  it('does not judge files without any tag, declaration files or non-module scripts', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/plain.ts': 'export const a = 1\n',
        'src/types.d.ts': '// [POS] 只有一段\ninterface A {}\n',
        'scripts/run.sh': '# [POS] 只有一段\n'
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })
})

describe('OUTPUT claims', () => {
  it('reports a claimed name the file does not export', () => {
    const snapshot = snapshotOf({
      sources: { 'src/a.ts': complete('无', 'foo · ghost', 'export const foo = 1') }
    })
    assert.deepEqual(findingsOf(snapshot), [
      'src/a.ts:2 [output-not-exported] [OUTPUT] 写了 ghost，但本文件没有导出它'
    ])
  })

  it('accepts slash lists, descriptions after a colon, wildcards and prose entries', () => {
    const body = [
      'export const foo = 1',
      'export const bar = 2',
      'export const AGY_DIAL_A = 3',
      'export const baz = 4'
    ].join('\n')
    const snapshot = snapshotOf({
      sources: {
        'src/a.ts': complete(
          '无',
          'foo/bar: 并列 · AGY_DIAL_* · 一句说明 · baz（括号里的 · 不切开）',
          body
        )
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('reports a wildcard that matches nothing', () => {
    const snapshot = snapshotOf({
      sources: { 'src/a.ts': complete('无', 'AGY_NOPE_*', 'export const AGY_DIAL_A = 1') }
    })
    assert.deepEqual(rulesOf(snapshot), ['output-not-exported'])
  })

  it('counts names a barrel forwards with `export *`', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/cfg/index.ts': complete('无', 'getConfig', "export * from './app'"),
        'src/cfg/app.ts': complete('无', 'getConfig', 'export function getConfig() {}')
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('survives a forwarding cycle between two files', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/a.ts': complete('无', 'fromB', "export * from './b'"),
        'src/b.ts': complete('无', 'fromB', "export * from './a'\nexport const fromB = 1")
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })
})

describe('INPUT references', () => {
  const beta = complete('无', 'bar', 'export function bar() {}')

  it('reports a symbol the target module does not export', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/a/alpha.ts': complete('beta::nope (POS: 乙)', 'foo', 'export const foo = 1'),
        'src/a/beta.ts': beta
      }
    })
    assert.deepEqual(findingsOf(snapshot), [
      'src/a/alpha.ts:1 [input-not-exported] [INPUT] 点名 beta::nope，但 src/a/beta.ts 没有导出它'
    ])
  })

  it('reports a module that resolves to no source file', () => {
    const snapshot = snapshotOf({
      sources: { 'src/a.ts': complete('gamma::x (POS: 丙)', 'foo', 'export const foo = 1') }
    })
    assert.deepEqual(rulesOf(snapshot), ['input-module-missing'])
  })

  it('lets INPUT name npm packages and builtin modules', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/a.ts': complete(
          'axios::default (POS: HTTP) · @scope/pkg::x (POS: 依赖) · fs::readFileSync (POS: 读文件)',
          'foo',
          'export const foo = 1'
        )
      },
      external: ['axios', '@scope/pkg', 'fs']
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('does not judge free-form entries (no `::` or no POS)', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/a.ts': complete(
          '用户配置 · electron (POS: 窗口) · beta::bar',
          'foo',
          'export const foo = 1'
        )
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('resolves through a barrel directory and `.tsx` modules', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/cfg/index.ts': complete('无', 'getConfig', "export * from './app'"),
        'src/cfg/app.ts': complete('无', 'getConfig', 'export function getConfig() {}'),
        'src/ui/panel.tsx': complete('无', 'Panel', 'export function Panel() {}'),
        'src/a.ts': complete(
          'cfg::getConfig (POS: 配置) · panel::Panel (POS: 面板)',
          'foo',
          'export const foo = 1'
        )
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('prefers the nearest same-named module, and skips ones it cannot tell apart', () => {
    const sources = {
      'src/x/manager.ts': complete('无', 'xManager', 'export const xManager = 1'),
      'src/y/manager.ts': complete('无', 'yManager', 'export const yManager = 1'),
      'src/x/user.ts': complete('manager::yManager (POS: 管理)', 'a', 'export const a = 1'),
      'src/z/user.ts': complete('manager::nope (POS: 管理)', 'b', 'export const b = 1')
    }
    assert.deepEqual(findingsOf(snapshotOf({ sources })), [
      'src/x/user.ts:1 [input-not-exported] [INPUT] 点名 manager::yManager，但 src/x/manager.ts 没有导出它'
    ])
  })

  it('treats a repo-rooted path as exact, even when the stem is shared', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/a/beta.ts': complete('无', 'fromA', 'export const fromA = 1'),
        'src/b/beta.ts': complete('无', 'fromB', 'export const fromB = 1'),
        'src/c/user.ts': complete(
          'src/a/beta::fromA (POS: 甲) · src/b/beta.ts::fromB (POS: 乙)',
          'a',
          'export const a = 1'
        )
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('counts the global declarations of a `.d.ts` file as exports', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/shared/types/app.d.ts': 'interface AppConfig {}\n',
        'src/a.ts': complete(
          'types/app.d::AppConfig (POS: 配置类型)',
          'foo',
          'export const foo = 1'
        )
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('supports wildcard symbols', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/beta.ts': complete('无', 'AGY_DIAL_A', 'export const AGY_DIAL_A = 1'),
        'src/a.ts': complete(
          'beta::AGY_DIAL_* (POS: 拨号) · beta::AGY_NOPE_* (POS: 空)',
          'foo',
          'export const foo = 1'
        )
      }
    })
    assert.deepEqual(findingsOf(snapshot), [
      'src/a.ts:1 [input-not-exported] [INPUT] 点名 beta::AGY_NOPE_*，但 src/beta.ts 没有导出它'
    ])
  })
})
