// [INPUT] docDriftRig::snapshotOf/findingsOf/rulesOf (POS: 文档漂移守护各测试共用的夹具，用几行字符串拼内存快照) ·
//         docDriftDocRules::contentLines/EXTERNAL_NAMES (POS: 文档漂移守护的文档规则，核对文档点名的东西还在不在)
// [OUTPUT] （无导出，仅测试）
// [POS] 文档规则的正反例：反引号里的文件名与标识符是否还在、相对链接是否可达、模块导航是否覆盖每份 _ARCH.md、
//       _ARCH.md 是否登记了本目录的源码文件，以及哪些写法不在判定范围内（围栏代码块、普通词、测试夹具、外部名字）。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { contentLines, EXTERNAL_NAMES } from './docDriftDocRules'
import { findingsOf, rulesOf, snapshotOf } from './docDriftRig'

const lines = (...rows: string[]): string => rows.join('\n')

describe('contentLines', () => {
  it('skips fenced code blocks and keeps 1-based line numbers', () => {
    const doc = lines('第一行', '```ts', '`HIDDEN_NAME`', '```', '第五行')
    assert.deepEqual(contentLines(doc), [
      { text: '第一行', line: 1 },
      { text: '第五行', line: 5 }
    ])
  })
})

describe('contentLines with CRLF', () => {
  it('splits CRLF documents without leaving carriage returns in the lines', () => {
    assert.deepEqual(contentLines('第一行\r\n```\r\n`HIDDEN`\r\n```\r\n第五行'), [
      { text: '第一行', line: 1 },
      { text: '第五行', line: 5 }
    ])
  })
})

describe('doc-file-missing', () => {
  const sources = { 'src/a/real.ts': 'export const a = 1\n' }

  it('reports a backticked source file that no longer exists', () => {
    const snapshot = snapshotOf({
      sources,
      docs: { 'ARCHITECTURE.md': lines('标题', '见 `src/a/gone.ts` 与 `real.ts`') }
    })
    assert.deepEqual(findingsOf(snapshot), [
      'ARCHITECTURE.md:2 [doc-file-missing] 文档提到源码文件 src/a/gone.ts，仓库里没有这个文件'
    ])
  })

  it('accepts bare names, path suffixes, doc-relative paths, line anchors and `@alias/` prefixes', () => {
    const snapshot = snapshotOf({
      sources,
      docs: {
        'src/a/_ARCH.md': lines(
          '`real.ts` · `a/real.ts` · `./real.ts` · `real.ts:12` · `real.ts:3-9`',
          '`@alias/a/real.ts` · `/Users/me/anything.ts`'
        )
      }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('reports a bare name that exists nowhere, and ignores extensions and non-source files', () => {
    const snapshot = snapshotOf({
      sources,
      docs: { 'ARCHITECTURE.md': '`missing.ts` · `notes.md` · `data.json` · `.d.ts` · `.test.ts`' }
    })
    assert.deepEqual(rulesOf(snapshot), ['doc-file-missing'])
  })

  it('does not read fenced code blocks', () => {
    const snapshot = snapshotOf({
      sources,
      docs: { 'ARCHITECTURE.md': lines('```', '`src/gone.ts`', '```') }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })
})

describe('doc-identifier-missing', () => {
  const sources = { 'src/a.ts': 'export const REAL_LIMIT = 3\nexport function realHelper() {}\n' }

  it('reports UPPER_SNAKE and camelCase names that no code uses', () => {
    const snapshot = snapshotOf({
      sources,
      docs: { 'ARCHITECTURE.md': '`GONE_LIMIT` · `goneHelper()` · `REAL_LIMIT` · `realHelper`' }
    })
    assert.deepEqual(findingsOf(snapshot), [
      'ARCHITECTURE.md:1 [doc-identifier-missing] 文档提到标识符 GONE_LIMIT，代码里没有这个名字（改名或删除后文档没跟上；外部名字登记到 EXTERNAL_NAMES）',
      'ARCHITECTURE.md:1 [doc-identifier-missing] 文档提到标识符 goneHelper，代码里没有这个名字（改名或删除后文档没跟上；外部名字登记到 EXTERNAL_NAMES）'
    ])
  })

  it('does not check ordinary words, single capitals or prose around the span', () => {
    const snapshot = snapshotOf({
      sources,
      docs: { 'ARCHITECTURE.md': '`use` · `Map` · `A` · `Foo` · `some words` · `a.b.c` · `x-y`' }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('accepts the registered external names', () => {
    const docs = { 'ARCHITECTURE.md': [...EXTERNAL_NAMES].map((name) => `\`${name}\``).join(' · ') }
    assert.deepEqual(findingsOf(snapshotOf({ sources, docs })), [])
  })

  it('treats a name that appears anywhere in code (even a comment) as present', () => {
    const snapshot = snapshotOf({
      sources: { 'src/a.ts': '// 见 legacyHelper\nexport const a = 1\n' },
      docs: { 'ARCHITECTURE.md': '`legacyHelper`' }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('does not let the guard samples vouch for a name, while its production code counts', () => {
    const snapshot = snapshotOf({
      sources: {
        'scripts/docDrift/sample.test.ts': 'const SAMPLE_ONLY_NAME = 1\n',
        'scripts/docDrift/sampleRig.ts': 'const SAMPLE_ONLY_NAME = 1\n',
        'scripts/docDrift/real.ts': 'export const realGuardName = 1\n'
      },
      docs: { 'ARCHITECTURE.md': '`SAMPLE_ONLY_NAME` · `realGuardName`' }
    })
    const findings = findingsOf(snapshot)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /\[doc-identifier-missing\] 文档提到标识符 SAMPLE_ONLY_NAME，/)
  })
})

describe('doc-link-broken', () => {
  it('reports a relative link to a missing target, resolved from the doc directory', () => {
    const snapshot = snapshotOf({
      docs: { 'src/a/_ARCH.md': '[ok](../b) · [bad](./gone.md) · [top](../../gone.md)' },
      paths: ['src/b/file.ts']
    })
    assert.deepEqual(findingsOf(snapshot), [
      'src/a/_ARCH.md:1 [doc-link-broken] 链接指向 src/a/gone.md，仓库里没有这个文件或目录',
      'src/a/_ARCH.md:1 [doc-link-broken] 链接指向 gone.md，仓库里没有这个文件或目录'
    ])
  })

  it('does not judge a link that climbs out of the repository', () => {
    const snapshot = snapshotOf({ docs: { 'src/a/_ARCH.md': '[out](../../../outside.md)' } })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('accepts files, directories, anchors, URLs and absolute paths', () => {
    const snapshot = snapshotOf({
      docs: {
        'ARCHITECTURE.md':
          '[f](VERSION_LOG.md#top) · [d](src) · [u](https://x.dev/a) · [m](mailto:a@b.c) · [s](/abs) · [h](#local)'
      },
      paths: ['VERSION_LOG.md', 'src/a.ts']
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('does not read links inside fenced code blocks', () => {
    const snapshot = snapshotOf({
      docs: { 'ARCHITECTURE.md': lines('```md', '[bad](gone.md)', '```') }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })
})

describe('arch-not-linked', () => {
  const sources = {
    'src/a/real.ts': 'export const a = 1\n',
    'src/b/real.ts': 'export const b = 1\n'
  }

  it('reports an _ARCH.md that the module navigation does not reach', () => {
    const snapshot = snapshotOf({
      sources,
      docs: {
        'ARCHITECTURE.md': '| 模块 | [a](src/a/_ARCH.md) |',
        'src/a/_ARCH.md': '`real.ts`',
        'src/b/_ARCH.md': '`real.ts`'
      }
    })
    assert.deepEqual(findingsOf(snapshot), [
      'ARCHITECTURE.md [arch-not-linked] 模块导航没有链到 src/b/_ARCH.md'
    ])
  })

  it('passes when every _ARCH.md is linked, and has nothing to judge without a root doc', () => {
    const arch = { 'src/a/_ARCH.md': '`real.ts`', 'src/b/_ARCH.md': '`real.ts`' }
    const linked = snapshotOf({
      sources,
      docs: { 'ARCHITECTURE.md': '[a](src/a/_ARCH.md) [b](src/b/_ARCH.md)', ...arch }
    })
    assert.deepEqual(findingsOf(linked), [])
    assert.deepEqual(findingsOf(snapshotOf({ sources, docs: arch })), [])
  })
})

describe('arch-file-unlisted', () => {
  it('reports a source file in the directory that the _ARCH.md never mentions', () => {
    const snapshot = snapshotOf({
      sources: { 'src/a/listed.ts': '', 'src/a/new.ts': '', 'src/a/new.test.ts': '' },
      docs: { 'src/a/_ARCH.md': '`listed.ts` 负责……' }
    })
    assert.deepEqual(findingsOf(snapshot), [
      'src/a/_ARCH.md [arch-file-unlisted] new.ts 在本目录里，但 _ARCH.md 没有登记它'
    ])
  })

  it('matches whole file names only (`xfoo.ts` or `a.foo.ts` do not list `foo.ts`)', () => {
    const snapshot = snapshotOf({
      sources: { 'src/a/foo.ts': '' },
      docs: { 'src/a/_ARCH.md': 'xfoo.ts · a.foo.ts · foo.tsx · foo.ts-old' }
    })
    assert.deepEqual(rulesOf(snapshot), ['arch-file-unlisted'])
    const listed = snapshotOf({
      sources: { 'src/a/foo.ts': '' },
      docs: { 'src/a/_ARCH.md': '见 `src/a/foo.ts` 与 `foo.ts:3`' }
    })
    assert.deepEqual(findingsOf(listed), [])
  })

  it('exempts tests, declaration files, test fixtures and nested directories', () => {
    const snapshot = snapshotOf({
      sources: {
        'src/a/x.test.ts': '',
        'src/a/types.d.ts': '',
        'src/a/probeRig.ts': '',
        'src/a/probeHarness.ts': '',
        'src/a/probeWorld.ts': '',
        'src/a/sub/deeper.ts': ''
      },
      docs: { 'src/a/_ARCH.md': '无' }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })

  it('only judges directories that have an _ARCH.md, and not the root document', () => {
    const snapshot = snapshotOf({
      sources: { 'src/b/new.ts': '', 'top.ts': '' },
      docs: { 'ARCHITECTURE.md': '[a](src/a/_ARCH.md)', 'src/a/_ARCH.md': '无' }
    })
    assert.deepEqual(findingsOf(snapshot), [])
  })
})
