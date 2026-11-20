// [INPUT] docDriftRepo::loadRepoSnapshot/SKIPPED_ROOT_DIRS (POS: 文档漂移守护的磁盘装载层，守护里唯一碰文件系统的一环) ·
//         docDriftCore::checkDocDrift/formatDriftReport/formatFinding (POS: 文档漂移守护的入口，一次判完文件头、_ARCH.md、ARCHITECTURE.md 与代码是否一致) ·
//         docDriftParse::hasAnyTag/parseHeader (POS: 文档漂移守护的文本解析层，从源码文本读出文件头、导出与标识符) ·
//         testing/tempDirs::makeTempDir (POS: 脚本测试共用的临时目录，退出时自动删除)
// [OUTPUT] （无导出，仅测试）
// [POS] 文档漂移守护的出口：真实仓库的文件头、_ARCH.md、ARCHITECTURE.md 此刻必须与代码一致，有漂移 `pnpm run test:node-quality` 就红；
//       另验证磁盘装载层的收录范围（跳过依赖与产物目录、收录文档与外部模块名）、没有根 `ARCHITECTURE.md` 的目录拒绝装载，
//       以及它跳过的目录都确实在 `.gitignore` 里。
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { makeTempDir } from '../testing/tempDirs'
import { checkDocDrift, formatDriftReport, formatFinding } from './docDriftCore'
import { hasAnyTag, parseHeader } from './docDriftParse'
import { loadRepoSnapshot, SKIPPED_ROOT_DIRS } from './docDriftRepo'

const ROOT = path.resolve(import.meta.dirname, '../..')

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
  }
}

describe('the repository docs match the code', () => {
  const snapshot = loadRepoSnapshot(ROOT)

  it('scans a real tree, so a broken loader cannot pass by finding nothing', () => {
    const archDocs = [...snapshot.docs.keys()].filter((file) => file.endsWith('/_ARCH.md'))
    const headed = [...snapshot.sources.values()].filter((text) => hasAnyTag(parseHeader(text)))
    assert.ok(snapshot.docs.has('ARCHITECTURE.md'))
    assert.ok(archDocs.length >= 5, `_ARCH.md 只找到 ${archDocs.length} 份`)
    assert.ok(snapshot.sources.size >= 300, `源码只找到 ${snapshot.sources.size} 个`)
    assert.ok(headed.length >= 150, `带文件头的只有 ${headed.length} 个`)
  })

  it('has no drift between file headers, _ARCH.md, ARCHITECTURE.md and the code', () => {
    const findings = checkDocDrift(snapshot)
    assert.equal(findings.length, 0, formatDriftReport(findings))
  })
})

describe('loadRepoSnapshot', () => {
  it('collects sources, docs and external modules, skipping dependency and output directories', () => {
    const root = makeTempDir('doc-drift-load-')
    writeFiles(root, {
      'package.json': JSON.stringify({
        dependencies: { axios: '1' },
        devDependencies: { vitest: '1' }
      }),
      'ARCHITECTURE.md': '# root',
      'README.md': 'readme',
      'docs/_ARCH.md': '# docs',
      'src/a/_ARCH.md': '# a',
      'src/a/x.ts': 'export const x = 1',
      'src/a/data.json': '{}',
      'src/a/node_modules/dep/index.ts': 'skipped',
      'src/dist/keep.ts': 'kept: only the root dist is a build output',
      'src/old/ARCHITECTURE.md': 'only the root one is the L1 doc',
      'scripts/run.sh': 'echo hi',
      'dist/bundle.ts': 'skipped',
      'resources/files/pack.mjs': 'skipped',
      'resources/icon.png': 'kept in paths only',
      '.tmp-scratch/_ARCH.md': 'skipped'
    })
    const snapshot = loadRepoSnapshot(root)

    assert.deepEqual([...snapshot.sources.keys()].sort(), [
      'scripts/run.sh',
      'src/a/x.ts',
      'src/dist/keep.ts'
    ])
    assert.equal(snapshot.sources.get('src/a/x.ts'), 'export const x = 1')
    assert.deepEqual([...snapshot.docs.keys()].sort(), [
      'ARCHITECTURE.md',
      'docs/_ARCH.md',
      'src/a/_ARCH.md'
    ])
    for (const kept of [
      'README.md',
      'src/a/data.json',
      'resources/icon.png',
      'src/old/ARCHITECTURE.md'
    ]) {
      assert.ok(snapshot.paths.has(kept), `${kept} 应该在 paths 里`)
    }
    for (const skipped of [
      'src/a/node_modules/dep/index.ts',
      'dist/bundle.ts',
      'resources/files/pack.mjs',
      '.tmp-scratch/_ARCH.md'
    ]) {
      assert.equal(snapshot.paths.has(skipped), false, `${skipped} 不该被收录`)
    }
    assert.ok(snapshot.externalModules.has('axios'))
    assert.ok(snapshot.externalModules.has('vitest'))
    assert.ok(snapshot.externalModules.has('fs'))
    assert.equal(snapshot.externalModules.has('left-pad'), false)
  })

  it('hands what it loads to the rules: a file the _ARCH.md does not list is caught', () => {
    const root = makeTempDir('doc-drift-e2e-')
    writeFiles(root, {
      'package.json': '{}',
      'ARCHITECTURE.md': '[a](src/a/_ARCH.md)',
      'src/a/_ARCH.md': '`listed.ts`',
      'src/a/listed.ts': 'export const a = 1',
      'src/a/new.ts': 'export const b = 1'
    })
    assert.deepEqual(checkDocDrift(loadRepoSnapshot(root)).map(formatFinding), [
      'src/a/_ARCH.md [arch-file-unlisted] new.ts 在本目录里，但 _ARCH.md 没有登记它'
    ])

    writeFiles(root, { 'src/a/_ARCH.md': '`listed.ts` `new.ts`' })
    assert.deepEqual(checkDocDrift(loadRepoSnapshot(root)), [])
  })

  it('refuses a tree without the root ARCHITECTURE.md instead of passing by checking nothing', () => {
    const root = makeTempDir('doc-drift-no-root-doc-')
    writeFiles(root, {
      'package.json': '{}',
      'src/a/_ARCH.md': '`a.ts`',
      'src/a/a.ts': 'export const a = 1'
    })
    assert.throws(() => loadRepoSnapshot(root), /ARCHITECTURE\.md/)
  })

  it('only skips directories that .gitignore ignores', () => {
    const ignored = new Set(
      readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
        .split('\n')
        .map((line) => line.trim().replace(/\/$/, ''))
    )
    for (const dir of SKIPPED_ROOT_DIRS) {
      assert.ok(ignored.has(dir), `${dir} 被装载层跳过，但不在 .gitignore 里（会让真实文件隐形）`)
    }
  })
})
