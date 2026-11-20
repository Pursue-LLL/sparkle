import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { writeFileAtomic } from './atomicFile'

describe('writeFileAtomic', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkle-atomic-file-'))
  const file = path.join(dir, 'state.json')

  beforeEach(() => {
    rmSync(file, { force: true })
    rmSync(`${file}.tmp`, { force: true })
  })

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the content and leaves no temporary file behind', async () => {
    await writeFileAtomic(file, '{"a":1}')

    assert.equal(readFileSync(file, 'utf8'), '{"a":1}')
    assert.equal(existsSync(`${file}.tmp`), false)
  })

  it('replaces an existing file completely, not just its head', async () => {
    writeFileSync(file, 'x'.repeat(1000), 'utf8')

    await writeFileAtomic(file, 'short')

    assert.equal(readFileSync(file, 'utf8'), 'short')
  })

  it('keeps overlapping writes whole: the last one issued is the one that stays', async () => {
    const payloads = Array.from({ length: 20 }, (_, index) => JSON.stringify({ round: index }))

    await Promise.all(payloads.map((payload) => writeFileAtomic(file, payload)))

    assert.equal(readFileSync(file, 'utf8'), payloads[19])
    assert.equal(existsSync(`${file}.tmp`), false)
  })

  it('reports a failed write to its own caller only, and later writes still go through', async () => {
    const failing = writeFileAtomic(file, undefined as unknown as string)
    const following = writeFileAtomic(file, 'after')

    await assert.rejects(failing)
    await following
    assert.equal(readFileSync(file, 'utf8'), 'after')
  })

  it('rejects when the directory does not exist and leaves nothing behind', async () => {
    const missing = path.join(dir, 'missing', 'state.json')

    await assert.rejects(writeFileAtomic(missing, '{}'))

    assert.equal(existsSync(missing), false)
  })
})
