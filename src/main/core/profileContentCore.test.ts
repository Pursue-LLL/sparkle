import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertValidProfileContent, InvalidProfileContentError } from './profileContentCore'

const LABEL = '主订阅'

function rejection(content: string): InvalidProfileContentError {
  try {
    assertValidProfileContent(content, LABEL)
  } catch (error) {
    assert.ok(error instanceof InvalidProfileContentError, String(error))
    return error
  }
  assert.fail(`accepted: ${JSON.stringify(content.slice(0, 60))}`)
}

describe('assertValidProfileContent', () => {
  describe('accepts a mapping that has configuration content', () => {
    for (const [section, value] of [
      ['proxies', '[{name: a, type: ss, server: x, port: 1}]'],
      ['proxy-providers', '{sub: {type: http, url: "https://example.com/sub"}}'],
      ['proxy-groups', '[{name: a, type: select, proxies: [DIRECT]}]'],
      ['rules', '[MATCH]'],
      ['rule-providers', '{cn: {type: http, behavior: domain}}']
    ] as const) {
      it(`through ${section} alone`, () => {
        assertValidProfileContent(`${section}: ${value}\n`, LABEL)
      })
    }

    it('with only groups and rules, a template whose nodes come from overrides', () => {
      assertValidProfileContent(
        'proxies: []\nproxy-groups:\n  - {name: a, type: select, proxies: [DIRECT]}\nrules:\n  - MATCH,a\n',
        LABEL
      )
    })

    it('with proxies written out', () => {
      assertValidProfileContent('proxies:\n  - {name: a, type: ss, server: x, port: 1}\n', LABEL)
    })

    it('with proxies supplied only by proxy-providers', () => {
      assertValidProfileContent(
        'proxy-providers:\n  sub:\n    type: http\n    url: https://example.com/sub\n',
        LABEL
      )
    })

    it('whatever the line endings, comments and extra keys', () => {
      assertValidProfileContent(
        '# generated\r\nmixed-port: 7890\r\nproxies:\r\n  - {name: a, type: ss, server: x, port: 1}\r\nrules:\r\n  - MATCH,DIRECT\r\n',
        LABEL
      )
    })

    it('written as JSON', () => {
      assertValidProfileContent('{"proxies": [{"name": "a", "type": "ss"}]}', LABEL)
    })
  })

  describe('rejects what is not a configuration', () => {
    it('plain text such as a rate-limit notice, and says how it begins', () => {
      const error = rejection('Too Many Requests. Please retry later.')

      assert.match(error.message, /^订阅内容不是有效的配置：主订阅（/)
      assert.match(error.message, /不是配置文件/)
      assert.match(error.message, /开头：「Too Many Requests\. Please retry later\.」/)
    })

    it('an HTML error page', () => {
      const error = rejection('<!DOCTYPE html>\n<html><body>502 Bad Gateway</body></html>')

      assert.match(error.message, /开头：「<!DOCTYPE html>/)
    })

    it('a top-level list', () => {
      assert.match(rejection('- a\n- b\n').message, /不是配置文件/)
    })

    it('a bare number, which YAML reads as a scalar', () => {
      assert.match(rejection('403').message, /不是配置文件/)
    })

    it('an empty or whitespace-only response', () => {
      assert.match(rejection('').message, /内容为空/)
      assert.match(rejection(' \r\n\t\n').message, /内容为空/)
    })

    it('a JSON error body, which parses as a mapping but has no configuration section', () => {
      const error = rejection('{"status": "error", "message": "token expired"}')

      assert.match(error.message, /没有非空的 proxies \/ proxy-providers \/ proxy-groups \/ rules/)
    })

    it('a configuration whose sections are all empty', () => {
      const error = rejection(
        'port: 7890\nproxies: []\nproxy-groups:\nproxy-providers: {}\nrules: []\nrule-providers: {}\n'
      )

      assert.match(error.message, /没有非空的/)
    })

    it('a document that holds only comments', () => {
      assert.match(rejection('# nothing here\n').message, /没有非空的/)
    })

    it('broken YAML, reporting the syntax problem and how the content begins', () => {
      const error = rejection('proxies: [unclosed\nrules: {')

      assert.match(error.message, /YAML 语法错误：/)
      assert.match(error.message, /开头：「proxies: \[unclosed rules: \{」/)
    })
  })

  describe('the content preview in the message', () => {
    it('collapses line breaks and runs of whitespace', () => {
      const error = rejection('Service\n\n   temporarily\tunavailable')

      assert.match(error.message, /开头：「Service temporarily unavailable」/)
    })

    it('stops after 80 characters instead of copying the whole response', () => {
      const error = rejection(`${'x'.repeat(200)} tail`)

      assert.match(error.message, new RegExp(`开头：「${'x'.repeat(80)}…」`))
      assert.ok(!error.message.includes('tail'))
    })

    it('hides credential values of a node definition that happens to open the content', () => {
      const error = rejection(
        '{name: a, password: hunter2, uuid: 11111111-2222-3333-4444-555555555555, broken'
      )

      assert.match(error.message, /YAML 语法错误：/)
      assert.match(error.message, /password: \*\*\*, uuid: \*\*\*, broken/)
      assert.ok(!error.message.includes('hunter2'))
      assert.ok(!error.message.includes('11111111'))
    })

    it('hides quoted values and tokens echoed by an error notice', () => {
      const error = rejection(`Rate limited token="abc def ghi" ${'y'.repeat(100)}`)

      assert.match(error.message, /Rate limited token=\*\*\* y+/)
      assert.ok(!error.message.includes('abc def'))
    })

    it('leaves a credential-looking word without a value alone', () => {
      assert.match(
        rejection('Your password has expired').message,
        /开头：「Your password has expired」/
      )
    })
  })

  it('throws an error that can be told apart from network failures', () => {
    const error = rejection('nope')

    assert.equal(error.name, 'InvalidProfileContentError')
    assert.ok(error instanceof Error)
  })
})
