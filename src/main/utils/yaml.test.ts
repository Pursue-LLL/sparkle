import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import yaml from 'yaml'
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

  it('reads documents without a Reality node exactly like the yaml library', () => {
    const documents = [
      'a: 1\nb: [x, y]\nc: {d: true, e: null}\n',
      'text: |\n  first\n\n  # kept\n  last\nfolded: >\n  a\n  b\n',
      'port: 0o17\nhex: 0x1f\nratio: 1e3\nid: 012\nshort-id: 456\n',
      'proxies:\n  - {name: a, port: 443}\n  - name: b\n    alpn: [h2]\nx: &n 5\ny: *n\n',
      '- name: a\n  short-id: 123\n'
    ]

    for (const document of documents) {
      assert.deepEqual(parseYaml(document), yaml.parse(document, { merge: true }))
    }
  })

  it('throws the first parse error', () => {
    assert.throws(
      () => parseYaml('a: [1\n'),
      (error) => error instanceof yaml.YAMLParseError
    )
    assert.throws(() => parseYaml('a: 1\n---\nb: 2\n'), /multiple documents/)
  })

  it('reports parse warnings and still returns the document', (t) => {
    const warnings = t.mock.method(process, 'emitWarning', () => undefined)

    assert.deepEqual(parseYaml('a: !foo bar\n'), { a: 'bar' })
    assert.equal(warnings.mock.callCount(), 1)
    assert.ok(warnings.mock.calls[0].arguments[0] instanceof yaml.YAMLWarning)
  })
})

describe('parseYaml Reality short-id', () => {
  it('keeps a short-id a string even when it looks like another type', () => {
    for (const text of ['12345678', '01234567', '1e5', '12e3456', '0x1f', '-12', '.5', 'true']) {
      assert.equal(shortIdOf(withRealityShortId(text)), text)
    }
    assert.equal(shortIdOf(withRealityShortId('ab12cd34')), 'ab12cd34')
    assert.equal(shortIdOf(withRealityShortId('"01234567"')), '01234567')
    assert.equal(shortIdOf(withRealityShortId("'1e5'")), '1e5')
  })

  it('keeps a trailing comment out of the short-id', () => {
    assert.equal(shortIdOf(withRealityShortId('12345678 # from the panel')), '12345678')
  })

  it('leaves null-like, explicitly tagged and collection short-id values alone', (t) => {
    const warnings = t.mock.method(process, 'emitWarning', () => undefined)

    assert.equal(shortIdOf(withRealityShortId('null')), null)
    assert.equal(shortIdOf(withRealityShortId('NULL')), null)
    assert.equal(shortIdOf(withRealityShortId('~')), null)
    assert.equal(shortIdOf(withRealityShortId('')), null)
    assert.equal(shortIdOf(withRealityShortId('# nothing yet')), null)
    assert.equal(shortIdOf(withRealityShortId('!!str 123')), '123')
    assert.equal(shortIdOf(withRealityShortId('!!int 123')), 123)
    assert.deepEqual(shortIdOf(withRealityShortId('[a, b]')), ['a', 'b'])
    assert.deepEqual(shortIdOf(withRealityShortId('{ k: v }')), { k: 'v' })
    assert.deepEqual(shortIdOf(withRealityShortId('{k: v}')), { k: 'v' })

    assert.equal(warnings.mock.callCount(), 0)
  })

  it('leaves a reality-opts that is not a mapping alone', () => {
    const parsed = parseYaml<{ proxies: RealityNode[] }>(
      [
        'proxies:',
        '  - name: a',
        '    reality-opts:',
        '  - name: b',
        '    reality-opts: 123',
        '  - name: c',
        '    reality-opts: [1, 2]',
        ''
      ].join('\n')
    )

    assert.deepEqual(
      parsed.proxies.map((proxy) => proxy['reality-opts']),
      [null, 123, [1, 2]]
    )
  })

  it('reads a short-id that is an alias by the YAML rules', () => {
    const withAnchor = (anchored: string): string =>
      `x-id: &sid ${anchored}\nproxies:\n  - name: a\n    reality-opts: {short-id: *sid}\n`

    assert.equal(shortIdOf(withAnchor("'012'")), '012')
    assert.equal(shortIdOf(withAnchor('012')), 12)
  })

  it('restores the text whichever way the proxy is written', () => {
    const documents: Record<string, string> = {
      'a flow mapping in a block list':
        'proxies:\n  - {name: a, type: vless, reality-opts: {public-key: pk, short-id: 01234567}}\n',
      'a flow reality-opts in a block proxy':
        'proxies:\n  - name: a\n    reality-opts: { public-key: pk, short-id: 01234567 }\n',
      'a short-id that comes first in a flow mapping':
        'proxies:\n  - {name: a, reality-opts: {short-id: 01234567, public-key: pk}}\n',
      'a flow mapping over several lines':
        'proxies:\n  - {\n      name: a,\n      reality-opts: {\n        short-id: 01234567,\n        public-key: pk\n      }\n    }\n',
      'a document written entirely in flow style':
        '{proxies: [{name: a, reality-opts: {public-key: pk, short-id: 01234567}}]}\n',
      'a base proxy merged in with <<':
        'x-base: &base\n  type: vless\n  reality-opts: {public-key: pk, short-id: 01234567}\nproxies:\n  - <<: *base\n    name: a\n'
    }

    for (const [style, document] of Object.entries(documents)) {
      assert.equal(shortIdOf(document), '01234567', style)
    }
  })

  it('restores the text of an anchored reality-opts and of every alias to it', () => {
    const content = [
      'proxies:',
      '  - name: a',
      '    reality-opts: &r {public-key: pk, short-id: 01234567}',
      '  - name: b',
      '    reality-opts: *r',
      ''
    ].join('\n')

    const parsed = parseYaml<{ proxies: RealityNode[] }>(content)

    assert.equal(parsed.proxies[0]?.['reality-opts']?.['short-id'], '01234567')
    assert.equal(parsed.proxies[1]?.['reality-opts']?.['short-id'], '01234567')
  })

  it('restores the text wherever a reality-opts block appears', () => {
    const content = [
      'proxy-providers:',
      '  inline:',
      '    type: inline',
      '    payload:',
      '      - {name: a, reality-opts: {short-id: 111}}',
      'proxy-groups:',
      '  - name: g',
      '    reality-opts:',
      '      short-id: 222',
      'nested:',
      '  proxies:',
      '    - name: c',
      '      reality-opts:',
      '        short-id: 333',
      ''
    ].join('\n')

    const parsed = parseYaml<{
      'proxy-providers': { inline: { payload: RealityNode[] } }
      'proxy-groups': RealityNode[]
      nested: { proxies: RealityNode[] }
    }>(content)

    assert.equal(parsed['proxy-providers'].inline.payload[0]?.['reality-opts']?.['short-id'], '111')
    assert.equal(parsed['proxy-groups'][0]?.['reality-opts']?.['short-id'], '222')
    assert.equal(parsed.nested.proxies[0]?.['reality-opts']?.['short-id'], '333')
  })

  it('restores the text in a document whose root is a list', () => {
    const parsed = parseYaml<RealityNode[]>('- name: a\n  reality-opts:\n    short-id: 123\n')

    assert.equal(parsed[0]?.['reality-opts']?.['short-id'], '123')
  })

  it('only touches the short-id of a reality-opts block', () => {
    const content = [
      'proxies:',
      '  - name: a',
      '    short-id: 111',
      '    x-reality-opts:',
      '      short-id: 222',
      '    reality-opts:',
      '      short-id: 333',
      '    short-id-2: 444',
      '  - name: b',
      '    reality-opts: # from the panel',
      '      short-id: 555',
      '    short-id: 666',
      'short-id: 777',
      ''
    ].join('\n')

    const parsed = parseYaml<{
      proxies: Array<RealityNode & { 'x-reality-opts'?: { 'short-id': unknown } }>
      'short-id': unknown
    }>(content)

    assert.equal(parsed.proxies[0]?.['short-id'], 111)
    assert.equal(parsed.proxies[0]?.['x-reality-opts']?.['short-id'], 222)
    assert.equal(parsed.proxies[0]?.['reality-opts']?.['short-id'], '333')
    assert.equal(parsed.proxies[1]?.['reality-opts']?.['short-id'], '555')
    assert.equal(parsed.proxies[1]?.['short-id'], 666)
    assert.equal(parsed['short-id'], 777)
  })

  it('restores every proxy of the list, not just the first reality node', () => {
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

  it('keeps the short-id a string when the proxy has block lists before reality-opts', () => {
    const content = [
      'proxies:',
      '  - name: a',
      '    alpn:',
      '      - h2',
      '      - http/1.1',
      '    reality-opts:',
      '      short-id: 01234567',
      '  - name: b',
      '    alpn:',
      '    - h2',
      '    servername: example.com',
      '    reality-opts:',
      '      short-id: 1e5',
      ''
    ].join('\n')

    const parsed = parseYaml<{ proxies: RealityNode[] }>(content)

    assert.equal(parsed.proxies[0]?.['reality-opts']?.['short-id'], '01234567')
    assert.equal(parsed.proxies[1]?.['reality-opts']?.['short-id'], '1e5')
  })

  it('supports a list written at the same indent as the proxies key', () => {
    const content = [
      'proxies:',
      '- name: a',
      '  alpn:',
      '  - h2',
      '  reality-opts:',
      '    short-id: 01234567',
      '- name: b',
      '  reality-opts:',
      '    short-id: 7654321',
      'mixed-port: 7890',
      ''
    ].join('\n')

    const parsed = parseYaml<{ proxies: RealityNode[] }>(content)

    assert.equal(parsed.proxies[0]?.['reality-opts']?.['short-id'], '01234567')
    assert.equal(parsed.proxies[1]?.['reality-opts']?.['short-id'], '7654321')
  })

  it('does not let column-zero comments or blank lines disturb the document', () => {
    const content = [
      'proxies:',
      '  - name: a',
      '    reality-opts:',
      '# commented out at column zero',
      '',
      '      short-id: 111',
      'note: |',
      '  first',
      '',
      '  # kept',
      '  last',
      ''
    ].join('\n')

    const parsed = parseYaml<{ proxies: RealityNode[]; note: string }>(content)

    assert.equal(parsed.proxies[0]?.['reality-opts']?.['short-id'], '111')
    assert.equal(parsed.note, 'first\n\n# kept\nlast\n')
  })

  it('starts every proxy outside reality-opts, whatever indentation the previous one used', () => {
    const content = [
      'proxies:',
      '- name: a',
      '  reality-opts:',
      '    short-id: 111',
      '-',
      '    name: b',
      '    short-id: 222',
      ''
    ].join('\n')

    const parsed = parseYaml<{ proxies: RealityNode[] }>(content)

    assert.equal(parsed.proxies[0]?.['reality-opts']?.['short-id'], '111')
    assert.equal(parsed.proxies[1]?.['short-id'], 222)
  })
})

describe('stringifyYaml', () => {
  it('writes block style YAML that parseYaml reads back', () => {
    const data = { a: 1, b: ['x', 'y'], c: { d: true } }

    assert.equal(stringifyYaml(data), 'a: 1\nb:\n  - x\n  - y\nc:\n  d: true\n')
    assert.deepEqual(parseYaml(stringifyYaml(data)), data)
  })
})
