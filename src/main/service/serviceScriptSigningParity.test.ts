import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { before, describe, it, mock } from 'node:test'
import { computeKeyId, generateKeyPair, KeyManager } from './key'

/**
 * 升级脚本（scripts/lib/serviceSignedRequest.ts）与 App（./api.ts）各有一份 SPARKLE-AUTH-V2 签名实现。
 * 脚本侧改动或 App 侧改动任何一边，都会让脚本被服务拒绝——这里用 App 自己产出的签名反向校验。
 */

type ScriptSigner = typeof import('../../../scripts/lib/serviceSignedRequest')
type AppApi = typeof import('./api')

let scriptSigner: ScriptSigner
let appApi: AppApi
const keyPair = generateKeyPair()

function verifyWithPublicKey(canonical: string, signature: string): boolean {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(keyPair.publicKey, 'base64'),
    format: 'der',
    type: 'spki'
  })
  return crypto.verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, 'base64'))
}

before(async () => {
  mock.module('../utils/dirs', { exports: { serviceIpcPath: () => '/tmp/unused.sock' } })
  mock.module('../utils/log', { exports: { appendAppLog: async () => undefined } })
  appApi = await import('./api')
  scriptSigner = await import('../../../scripts/lib/serviceSignedRequest')

  const keyManager = new KeyManager()
  keyManager.setKeyPair(keyPair.publicKey, keyPair.privateKey, keyPair.keyId)
  appApi.initServiceAPI(keyManager)
})

describe('script signer / app signer parity', () => {
  const requests: Array<[string, string, string]> = [
    ['GET', '/core/controller/connections', ''],
    ['POST', '/core/stop', ''],
    ['PUT', '/core/controller/configs?z=1&force=true&force=false', '{"path":"","payload":""}'],
    ['DELETE', '/core/controller/connections/a%20b%2Fc?q=x%20y&q=a', '']
  ]

  for (const [method, pathWithQuery, body] of requests) {
    it(`script canonical request verifies the app signature: ${method} ${pathWithQuery}`, () => {
      const appHeaders = appApi.getServiceAuthHeaders(method, pathWithQuery, Buffer.from(body))
      const canonical = scriptSigner.buildCanonicalRequest({
        timestamp: appHeaders['X-Timestamp'],
        nonce: appHeaders['X-Nonce'],
        keyId: appHeaders['X-Key-Id'],
        method,
        pathWithQuery,
        bodyHash: appHeaders['X-Content-SHA256']
      })
      assert.equal(verifyWithPublicKey(canonical, appHeaders['X-Signature']), true)
    })

    it(`script and app emit the same header set and body hash: ${method} ${pathWithQuery}`, () => {
      const payload = Buffer.from(body)
      const appHeaders = appApi.getServiceAuthHeaders(method, pathWithQuery, payload)
      const scriptHeaders = scriptSigner.signServiceRequest(method, pathWithQuery, payload, keyPair)
      assert.deepEqual(Object.keys(scriptHeaders).sort(), Object.keys(appHeaders).sort())
      assert.equal(scriptHeaders['X-Content-SHA256'], appHeaders['X-Content-SHA256'])
      assert.equal(scriptHeaders['X-Key-Id'], appHeaders['X-Key-Id'])
      assert.equal(scriptHeaders['X-Auth-Version'], appHeaders['X-Auth-Version'])
    })
  }

  it('derives the same key id, including for padded input', () => {
    assert.equal(scriptSigner.computeKeyId(keyPair.publicKey), computeKeyId(keyPair.publicKey))
    assert.equal(
      scriptSigner.computeKeyId(`  ${keyPair.publicKey}\n`),
      computeKeyId(keyPair.publicKey)
    )
  })
})
