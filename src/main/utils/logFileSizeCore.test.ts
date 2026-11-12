import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { forSeeds } from '../core/seededProperty'
import {
  nextLogFileSizeAfterAppend,
  resolveCachedLogFileSize,
  shouldTrimLogFile,
  trimLogContent,
  trimTargetBytes
} from './logFileSizeCore'

describe('logFileSizeCore', () => {
  it('uses cached size for same path', () => {
    assert.equal(resolveCachedLogFileSize({ path: '/tmp/a.log', size: 42 }, '/tmp/a.log'), 42)
    assert.equal(resolveCachedLogFileSize({ path: '/tmp/a.log', size: 42 }, '/tmp/b.log'), null)
  })

  it('has no cached size before the first measurement', () => {
    assert.equal(resolveCachedLogFileSize(undefined, '/tmp/a.log'), null)
    assert.equal(resolveCachedLogFileSize({ path: '/tmp/a.log', size: null }, '/tmp/a.log'), null)
    assert.equal(resolveCachedLogFileSize({ path: '/tmp/a.log', size: 0 }, '/tmp/a.log'), 0)
  })

  it('computes append and trim thresholds', () => {
    assert.equal(nextLogFileSizeAfterAppend(100, 5), 105)
    assert.equal(shouldTrimLogFile(105, 100), true)
    assert.equal(trimTargetBytes(100, 0.7), 70)
  })

  it('trims only above the limit and always keeps at least one byte as the target', () => {
    assert.equal(shouldTrimLogFile(100, 100), false)
    assert.equal(shouldTrimLogFile(101, 100), true)
    assert.equal(trimTargetBytes(1, 0.7), 1)
    assert.equal(trimTargetBytes(3, 0.7), 2)
  })
})

describe('trimLogContent', () => {
  it('leaves content within the target alone, normalised to LF', () => {
    assert.deepEqual(trimLogContent('a\nb\n', 4), { content: 'a\nb\n', size: 4, trimmed: false })
    assert.deepEqual(trimLogContent('a\r\nb\r\n', 100), {
      content: 'a\nb\n',
      size: 4,
      trimmed: false
    })
    assert.deepEqual(trimLogContent('', 0), { content: '', size: 0, trimmed: false })
  })

  it('drops the oldest whole lines until the content fits', () => {
    assert.deepEqual(trimLogContent('aaa\nbbb\nccc\n', 8), {
      content: 'bbb\nccc\n',
      size: 8,
      trimmed: true
    })
    assert.deepEqual(trimLogContent('aaa\nbbb\nccc\n', 7), {
      content: 'ccc\n',
      size: 4,
      trimmed: true
    })
  })

  it('keeps a missing final newline missing', () => {
    assert.deepEqual(trimLogContent('aaa\nbbb\nccc', 7), {
      content: 'bbb\nccc',
      size: 7,
      trimmed: true
    })
    assert.deepEqual(trimLogContent('aaa\nbbb\nccc', 3), {
      content: 'ccc',
      size: 3,
      trimmed: true
    })
  })

  it('counts bytes, not characters', () => {
    assert.deepEqual(trimLogContent('日志一\n日志二\n', 10), {
      content: '日志二\n',
      size: 10,
      trimmed: true
    })
  })

  it('drops everything when no line fits', () => {
    assert.deepEqual(trimLogContent('aaaa\nbbbb\n', 3), { content: '', size: 0, trimmed: true })
    assert.deepEqual(trimLogContent('one very long line', 5), {
      content: '',
      size: 0,
      trimmed: true
    })
  })

  it('keeps blank lines it does not have to drop', () => {
    assert.deepEqual(trimLogContent('a\n\n\nb\n', 5), {
      content: '\n\nb\n',
      size: 4,
      trimmed: true
    })
  })

  it('keeps the longest newest suffix of lines within the target', () => {
    const alphabet = ['a', 'bb', '日', 'cccc', '']
    forSeeds(300, (random) => {
      const lines = Array.from({ length: random.int(0, 12) }, () =>
        Array.from({ length: random.int(0, 4) }, () => random.pick(alphabet)).join('')
      )
      const eol = random.pick(['\n', '\r\n'])
      const raw = lines.join(eol) + (lines.length > 0 && random.chance(0.7) ? eol : '')
      const target = random.int(0, Buffer.byteLength(raw) + 2)

      const result = trimLogContent(raw, target)
      const normalized = raw.replace(/\r\n/g, '\n')
      const normalizedSize = Buffer.byteLength(normalized)

      assert.equal(result.size, Buffer.byteLength(result.content))
      assert.equal(result.trimmed, normalizedSize > target)
      if (!result.trimmed) {
        assert.equal(result.content, normalized)
        return
      }

      assert.ok(result.size <= target, 'the result fits')
      assert.ok(normalized.endsWith(result.content), 'only the oldest lines were dropped')
      const hasTrailingNewline = normalized.endsWith('\n')
      // 能放下的最长后缀：再多留一行（连同它的换行）就超出目标
      const dropped = normalized.slice(0, normalized.length - result.content.length)
      const body = (hasTrailingNewline ? normalized.slice(0, -1) : normalized).split('\n')
      const keptLineCount =
        result.content === '' ? 0 : result.content.split('\n').length - (hasTrailingNewline ? 1 : 0)
      const nextLine = body[body.length - keptLineCount - 1]
      assert.notEqual(nextLine, undefined, 'something was dropped')
      assert.ok(dropped === '' || dropped.endsWith('\n') || result.content === '', 'whole lines')
      const newlineBytes = keptLineCount === 0 && !hasTrailingNewline ? 0 : 1
      assert.ok(result.size + Buffer.byteLength(nextLine) + newlineBytes > target, 'maximal')
    })
  })
})
