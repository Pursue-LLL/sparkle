import asar from '@electron/asar'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { parseBakedBuildStamp, readBakedBuildStampFromAsar } from './sparkleBakedBuildStampCore'

describe('parseBakedBuildStamp', () => {
  it('reads the declarations as the bundler emits them', () => {
    const bundle = 'const SPARKLE_GIT_COMMIT = "76ac0dd";\nconst SPARKLE_GIT_DIRTY = false;\n'
    assert.deepEqual(parseBakedBuildStamp(bundle), { commit: '76ac0dd', dirty: false })
  })

  it('reads the declarations as src/shared/buildStamp.ts writes them', () => {
    const source =
      "export const SPARKLE_GIT_COMMIT = '76ac0dd'\nexport const SPARKLE_GIT_DIRTY = true\n"
    assert.deepEqual(parseBakedBuildStamp(source), { commit: '76ac0dd', dirty: true })
  })

  it('reads minified declarations, where true is written as !0', () => {
    assert.deepEqual(
      parseBakedBuildStamp('a=1,SPARKLE_GIT_COMMIT="abc1234",SPARKLE_GIT_DIRTY=!0;'),
      {
        commit: 'abc1234',
        dirty: true
      }
    )
    assert.deepEqual(parseBakedBuildStamp('SPARKLE_GIT_COMMIT="abc1234",SPARKLE_GIT_DIRTY=!1;'), {
      commit: 'abc1234',
      dirty: false
    })
  })

  it('treats a missing dirty flag as clean', () => {
    assert.deepEqual(parseBakedBuildStamp('const SPARKLE_GIT_COMMIT = "76ac0dd";'), {
      commit: '76ac0dd',
      dirty: false
    })
  })

  it('does not treat a longer identifier or value as the dirty flag', () => {
    const bundle = 'const SPARKLE_GIT_COMMIT = "76ac0dd";\nconst SPARKLE_GIT_DIRTY = trueish;'
    assert.equal(parseBakedBuildStamp(bundle)?.dirty, false)
  })

  it('ignores a mere use of the constant and finds the declaration that follows', () => {
    const bundle = 'log(SPARKLE_GIT_COMMIT, 1)\nconst SPARKLE_GIT_COMMIT = "76ac0dd";'
    assert.equal(parseBakedBuildStamp(bundle)?.commit, '76ac0dd')
  })

  it('returns undefined when no commit is declared or it is empty', () => {
    assert.equal(parseBakedBuildStamp('log(SPARKLE_GIT_COMMIT)'), undefined)
    assert.equal(parseBakedBuildStamp('const SPARKLE_GIT_COMMIT = "";'), undefined)
    assert.equal(parseBakedBuildStamp(''), undefined)
  })
})

/** 把文件树打成 asar（只含传入的 main chunk），返回 asar 路径。 */
async function packMainChunks(chunks: Record<string, string>): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkle-baked-stamp-'))
  const mainDir = path.join(root, 'app', 'out', 'main')
  mkdirSync(mainDir, { recursive: true })
  for (const [name, content] of Object.entries(chunks)) {
    writeFileSync(path.join(mainDir, name), content, 'utf8')
  }
  const asarPath = path.join(root, 'app.asar')
  await asar.createPackage(path.join(root, 'app'), asarPath)
  return asarPath
}

describe('readBakedBuildStampFromAsar', () => {
  it('reads the stamp when the bundler inlined it into index.js (no buildStamp chunk)', async () => {
    const asarPath = await packMainChunks({
      'index.js':
        'const SPARKLE_BUILD_STAMP = "2026.1113.1003";\nconst SPARKLE_GIT_COMMIT = "76ac0dd";\nconst SPARKLE_GIT_DIRTY = false;'
    })
    assert.deepEqual(readBakedBuildStampFromAsar(asarPath), { commit: '76ac0dd', dirty: false })
  })

  it('reads the stamp when the bundler split it into its own hashed chunk', async () => {
    const asarPath = await packMainChunks({
      'index.js': 'import "./buildStamp-Ab12Cd34.js"',
      'buildStamp-Ab12Cd34.js':
        'const SPARKLE_GIT_COMMIT = "53cca75";\nconst SPARKLE_GIT_DIRTY = true;'
    })
    assert.deepEqual(readBakedBuildStampFromAsar(asarPath), { commit: '53cca75', dirty: true })
  })

  it('returns undefined for a build that carries no stamp', async () => {
    const asarPath = await packMainChunks({ 'index.js': 'appendAppLog' })
    assert.equal(readBakedBuildStampFromAsar(asarPath), undefined)
  })

  it('throws for an asar without main-process chunks instead of reporting a false unknown', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sparkle-baked-stamp-empty-'))
    mkdirSync(path.join(root, 'app'), { recursive: true })
    writeFileSync(path.join(root, 'app', 'package.json'), '{}', 'utf8')
    const asarPath = path.join(root, 'app.asar')
    await asar.createPackage(path.join(root, 'app'), asarPath)
    assert.throws(() => readBakedBuildStampFromAsar(asarPath), /asar missing out\/main/)
  })
})
