// [INPUT] docDriftParse::parseHeader/hasAnyTag/splitTopLevel/inputRefs/outputClaims/exportsOf/collectWords (POS: 文档漂移守护的文本解析层：从源码文本读出文件头、导出与标识符)
// [OUTPUT] （无导出，仅测试）
// [POS] 文本解析层的行为测试：文件头的几种写法、条目切分，以及 INPUT / OUTPUT 的判定文法
//       （哪些写法算「点名」要核对，哪些是说明文字不核对）、导出识别。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectWords,
  exportsOf,
  hasAnyTag,
  inputRefs,
  outputClaims,
  parseHeader,
  splitTopLevel
} from './docDriftParse'

const lines = (...rows: string[]): string => rows.join('\n')

describe('parseHeader', () => {
  it('reads line-comment sections, joining continuation lines', () => {
    const header = parseHeader(
      lines(
        '// [INPUT] a::x (POS: A) ·',
        '//         b::y (POS: B)',
        '// [OUTPUT] foo · bar',
        '// [POS] 一句话。',
        '// 续行。',
        "import x from 'x'"
      )
    )
    assert.deepEqual(header.sections, {
      INPUT: 'a::x (POS: A) · b::y (POS: B)',
      OUTPUT: 'foo · bar',
      POS: '一句话。 续行。'
    })
    assert.deepEqual(header.lines, { INPUT: 1, OUTPUT: 3, POS: 4 })
  })

  it('reads a header written with CRLF line endings', () => {
    const header = parseHeader(
      ['// [INPUT] a', '//         b', '// [OUTPUT] c', '// [POS] d', 'const x = 1'].join('\r\n')
    )
    assert.deepEqual(header.sections, { INPUT: 'a b', OUTPUT: 'c', POS: 'd' })
  })

  it('reads block-comment sections', () => {
    const header = parseHeader(
      lines('/**', ' * [INPUT] 无', ' * [OUTPUT] foo', ' *          bar', ' * [POS] 说明', ' */')
    )
    assert.deepEqual(header.sections, { INPUT: '无', OUTPUT: 'foo bar', POS: '说明' })
  })

  it('finds a header placed after the imports', () => {
    const header = parseHeader(
      lines("import a from 'a'", '', '/**', ' * [INPUT] x', ' * [OUTPUT] y', ' * [POS] z', ' */')
    )
    assert.deepEqual(header.sections, { INPUT: 'x', OUTPUT: 'y', POS: 'z' })
    assert.equal(header.lines.INPUT, 4)
  })

  it('ends a section at the first code line', () => {
    const header = parseHeader(lines('// [POS] 说明', "import a from 'a'", '// 这是正文注释'))
    assert.equal(header.sections.POS, '说明')
  })

  it('keeps the first occurrence of a tag', () => {
    const header = parseHeader(
      lines('// [OUTPUT] real', "import a from 'a'", '// [OUTPUT] example in a comment', '// more')
    )
    assert.equal(header.sections.OUTPUT, 'real')
  })

  it('does not take a tag mentioned mid-sentence, and ignores text without tags', () => {
    const header = parseHeader(lines('// 见 [POS] 一节', 'export const a = 1'))
    assert.equal(hasAnyTag(header), false)
    assert.deepEqual(header.sections, {})
  })

  it('does not scan past the first 60 lines', () => {
    const filler = Array.from({ length: 70 }, (_, i) => `const v${i} = ${i}`)
    assert.equal(hasAnyTag(parseHeader(lines(...filler, '// [POS] 太靠后'))), false)
  })

  it('reports an empty tag as present but empty', () => {
    const header = parseHeader(lines('// [INPUT]', '// [OUTPUT] foo'))
    assert.equal(header.sections.INPUT, '')
    assert.equal(header.sections.OUTPUT, 'foo')
  })
})

describe('splitTopLevel', () => {
  it('does not split on separators inside half- or full-width parentheses', () => {
    assert.deepEqual(splitTopLevel('a · b（x · y） · c (p · q) ·  · d'), [
      'a',
      'b（x · y）',
      'c (p · q)',
      'd'
    ])
  })
})

describe('inputRefs', () => {
  it('parses canonical `module::symbols (POS: …)` entries and skips free-form ones', () => {
    const refs = inputRefs(
      lines(
        'utils/log::appendAppLog (POS: 应用日志) · sparkleAgyCli::a / b/c…（POS: agy CLI）·',
        '电话本 · electron (POS: 窗口) · ws::WebSocket · m::甲 (POS: x)'
      )
    )
    assert.deepEqual(refs, [
      { module: 'utils/log', symbols: ['appendAppLog'] },
      { module: 'sparkleAgyCli', symbols: ['a', 'b', 'c'] }
    ])
  })

  it('keeps wildcard symbols and does not split inside a POS label', () => {
    assert.deepEqual(inputRefs('m::AGY_DIAL_STORM_* (POS: 甲 · 乙) · n::b (POS: y)'), [
      { module: 'm', symbols: ['AGY_DIAL_STORM_*'] },
      { module: 'n', symbols: ['b'] }
    ])
  })

  it('accepts repo-rooted paths with an extension', () => {
    assert.deepEqual(inputRefs('scripts/lib/serviceSignedRequest.ts::callService (POS: 签名)'), [
      { module: 'scripts/lib/serviceSignedRequest.ts', symbols: ['callService'] }
    ])
  })
})

describe('outputClaims', () => {
  it('takes the names before a colon, outside parentheses, and skips prose', () => {
    const claims = outputClaims(
      [
        'foo · bar: 说明 · baz（括号 · 里） · 中文说明 · start/stop Thing',
        'cacheRecord/cacheKey · A / B: 说明 · AGY_* · pnpm run x [参数]: 说明'
      ].join(' · ')
    )
    assert.deepEqual(claims, ['foo', 'bar', 'baz', 'cacheRecord', 'cacheKey', 'A', 'B', 'AGY_*'])
  })

  it('treats a shared-prefix shorthand as prose instead of guessing the expansion', () => {
    assert.deepEqual(outputClaims('start/stop MihomoTraffic'), [])
  })
})

describe('exportsOf', () => {
  it('collects declarations, lists, renames, type-only exports and star re-exports', () => {
    const info = exportsOf(
      lines(
        'export function a() {}',
        'export async function b() {}',
        'export const c = 1',
        'export class D {}',
        'export type E = string',
        'export interface F {}',
        'export enum G {}',
        'export const enum H {}',
        "export { i, j as k, type L } from './x'",
        'export { m }',
        "export * from './y'",
        "export * as ns from './z'",
        'export default function dflt() {}',
        '// export const commented = 1',
        '  export const indented = 1'
      )
    )
    assert.deepEqual([...info.names].sort(), [
      'D',
      'E',
      'F',
      'G',
      'H',
      'L',
      'a',
      'b',
      'c',
      'dflt',
      'i',
      'k',
      'm',
      'ns'
    ])
    assert.deepEqual(info.starFrom, ['./y'])
  })

  it('counts every name in a default-export expression', () => {
    const names = exportsOf('export default React.memo(ProxyItem)').names
    assert.ok(names.has('ProxyItem'))
    assert.ok(exportsOf('export default App').names.has('App'))
  })

  it('treats top-level declarations of a declaration file as global exports', () => {
    const text = lines('interface Ambient {}', 'declare const flag: number', 'type T = string')
    assert.deepEqual([...exportsOf(text, true).names].sort(), ['Ambient', 'T', 'flag'])
    assert.deepEqual([...exportsOf(text).names], [])
  })
})

describe('collectWords', () => {
  it('collects identifiers including underscores and dollars', () => {
    const words = new Set<string>()
    collectWords('const FOO_BAR = $x + Foo2 // 注释 baz', words)
    assert.deepEqual([...words].sort(), ['FOO_BAR', 'Foo2', 'baz', 'const', '$x'].sort())
  })
})
