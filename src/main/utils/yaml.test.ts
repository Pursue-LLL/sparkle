import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseYaml, stringifyYaml } from './yaml'

interface RealityNode {
  name: string
  'short-id'?: unknown
  'reality-opts'?: { 'public-key'?: string; 'short-id'?: unknown }
}

const shortIdOf = (content: string): unknown =>
  parseYaml<{ proxies: RealityNode[] }>(content).proxies[0]?.['reality-opts']?.['short-id']

const withRealityShortId = (value: string): string =>
  [
    'proxies:',
    '  - name: a',
    '    reality-opts:',
    '      public-key: pk',
    `      short-id: ${value}`,
    ''
  ].join('\n')

describe('parseYaml', () => {
  it('returns an empty object for empty or null documents', () => {
    assert.deepEqual(parseYaml(''), {})
    assert.deepEqual(parseYaml('null'), {})
    assert.deepEqual(parseYaml('# only a comment\n'), {})
  })

  it('expands merge keys', () => {
    const parsed = parseYaml<{ child: Record<string, number> }>(
      'base: &b\n  a: 1\nchild:\n  <<: *b\n  c: 2\n'
    )

    assert.deepEqual(parsed.child, { a: 1, c: 2 })
  })

  it('keeps a Reality short-id a string even when it looks like a number', () => {
    assert.equal(shortIdOf(withRealityShortId('12345678')), '12345678')
    assert.equal(shortIdOf(withRealityShortId('01234567')), '01234567')
    assert.equal(shortIdOf(withRealityShortId('1e5')), '1e5')
    assert.equal(shortIdOf(withRealityShortId('ab12cd34')), 'ab12cd34')
  })

  it('keeps a trailing comment out of the short-id', () => {
    assert.equal(shortIdOf(withRealityShortId('12345678 # from the panel')), '12345678')
  })

  it('leaves null-like, already tagged and inline-collection short-id values alone', () => {
    assert.equal(shortIdOf(withRealityShortId('null')), null)
    assert.equal(shortIdOf(withRealityShortId('~')), null)
    assert.equal(shortIdOf(withRealityShortId('!!str 123')), '123')
    assert.deepEqual(shortIdOf(withRealityShortId('[a, b]')), ['a', 'b'])
    assert.deepEqual(shortIdOf(withRealityShortId('{ k: v }')), { k: 'v' })
  })

  it('only rewrites short-id inside reality-opts of a top-level proxies list', () => {
    const content = [
      'proxies:',
      '  - name: a',
      '    short-id: 111',
      '    reality-opts:',
      '      short-id: 222',
      '    other: 1',
      '  - name: b',
      '    short-id: 333',
      'proxy-groups:',
      '  - name: g',
      '    reality-opts:',
      '      short-id: 444',
      'nested:',
      '  proxies:',
      '    - name: c',
      '      reality-opts:',
      '        short-id: 555',
      ''
    ].join('\n')

    const parsed = parseYaml<{
      proxies: RealityNode[]
      'proxy-groups': RealityNode[]
      nested: { proxies: RealityNode[] }
    }>(content)

    assert.equal(parsed.proxies[0]?.['short-id'], 111)
    assert.equal(parsed.proxies[0]?.['reality-opts']?.['short-id'], '222')
    assert.equal(parsed.proxies[1]?.['short-id'], 333)
    assert.equal(parsed['proxy-groups'][0]?.['reality-opts']?.['short-id'], 444)
    assert.equal(parsed.nested.proxies[0]?.['reality-opts']?.['short-id'], 555)
  })

  it('rewrites every proxy of the list, not just the first reality node', () => {
    const content = [
      'proxies:',
      '  - name: a',
      '    reality-opts:',
      '      short-id: 111',
      '  - name: b',
      '    type: vless',
      '  - name: c',
      '    reality-opts:',
      '      # keep the comment',
      '',
      '      short-id: 333',
      ''
    ].join('\n')

    const parsed = parseYaml<{ proxies: RealityNode[] }>(content)

    assert.equal(parsed.proxies[0]?.['reality-opts']?.['short-id'], '111')
    assert.equal(parsed.proxies[2]?.['reality-opts']?.['short-id'], '333')
  })

  it('does not touch documents that mention neither proxies nor short-id', () => {
    assert.deepEqual(parseYaml('a: 123\nshort-id: 456\n'), { a: 123, 'short-id': 456 })
  })
})

describe('stringifyYaml', () => {
  it('writes block style YAML that parseYaml reads back', () => {
    const data = { a: 1, b: ['x', 'y'], c: { d: true } }

    assert.equal(stringifyYaml(data), 'a: 1\nb:\n  - x\n  - y\nc:\n  d: true\n')
    assert.deepEqual(parseYaml(stringifyYaml(data)), data)
  })
})
