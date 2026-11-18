import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AxiosError } from 'axios'
import { redactUrl, toDownloadError } from './downloadErrorCore'

// 令牌可能在路径、查询串或 `用户:密码@` 里，三处都放进来，错误信息里一个都不能出现。
const PATH_SECRET = 'PATHSECRET0123456789'
const QUERY_SECRET = 'QUERYSECRET'
const USER_SECRET = 'USERSECRET'
const URL_WITH_SECRETS = `https://${USER_SECRET}:p%40ss@sub.example.com:8443/link/${PATH_SECRET}?token=${QUERY_SECRET}&flag=clash#frag`
const REDACTED = 'https://sub.example.com:8443'

function download(code: string | undefined, message: string): AxiosError {
  return new AxiosError(message, code)
}

function messageOf(result: unknown): string {
  assert.ok(result instanceof Error, String(result))
  return result.message
}

describe('redactUrl', () => {
  it('keeps the scheme, host and port only', () => {
    assert.equal(redactUrl(URL_WITH_SECRETS), REDACTED)
  })

  it('leaves no trace of the path, query, fragment or credentials', () => {
    const redacted = redactUrl(URL_WITH_SECRETS)
    for (const secret of [PATH_SECRET, QUERY_SECRET, USER_SECRET, 'frag', 'flag']) {
      assert.ok(!redacted.includes(secret), `${secret} survived in ${redacted}`)
    }
  })

  it('drops the port when it is the scheme default', () => {
    assert.equal(redactUrl('https://sub.example.com:443/a?b=c'), 'https://sub.example.com')
  })

  it('keeps the brackets of an IPv6 host', () => {
    assert.equal(redactUrl('http://[2001:db8::1]:9090/x?t=1'), 'http://[2001:db8::1]:9090')
  })

  it('shows a placeholder, never the input, when the address cannot be parsed', () => {
    const redacted = redactUrl(`not a url?token=${QUERY_SECRET}`)
    assert.ok(!redacted.includes(QUERY_SECRET), redacted)
    assert.notEqual(redacted, '')
  })
})

describe('toDownloadError', () => {
  const cases = [
    ['ECONNRESET', 'socket hang up', `网络连接被重置或超时：${REDACTED}`],
    ['ECONNABORTED', 'timeout of 0ms exceeded', `网络连接被重置或超时：${REDACTED}`],
    ['CERT_HAS_EXPIRED', 'certificate has expired', `服务器证书已过期：${REDACTED}`],
    [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'unable to verify the first certificate',
      `无法验证服务器证书：${REDACTED}`
    ],
    [undefined, 'Certificate verification failed: x', `证书验证失败：${REDACTED}`]
  ] as const

  for (const [code, message, expected] of cases) {
    it(`words ${code ?? message} for the user without the subscription address`, () => {
      const text = messageOf(toDownloadError(download(code, message), URL_WITH_SECRETS))

      assert.equal(text, expected)
      for (const secret of [PATH_SECRET, QUERY_SECRET, USER_SECRET]) {
        assert.ok(!text.includes(secret), `${secret} survived in ${text}`)
      }
    })
  }

  it('lets the error code decide before the message text', () => {
    const text = messageOf(
      toDownloadError(download('ECONNRESET', 'Certificate verification failed'), URL_WITH_SECRETS)
    )

    assert.equal(text, `网络连接被重置或超时：${REDACTED}`)
  })

  it('passes any other axios failure through as a request failure', () => {
    const text = messageOf(
      toDownloadError(
        download('ERR_BAD_RESPONSE', 'Request failed with status code 503'),
        URL_WITH_SECRETS
      )
    )

    assert.equal(text, '请求失败：Request failed with status code 503')
  })

  it('hands back anything that is not an axios failure untouched', () => {
    const own = new Error('证书指纹不匹配')

    assert.equal(toDownloadError(own, URL_WITH_SECRETS), own)
    assert.equal(toDownloadError('boom', URL_WITH_SECRETS), 'boom')
    assert.equal(toDownloadError(undefined, URL_WITH_SECRETS), undefined)
  })
})
