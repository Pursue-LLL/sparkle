import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  closeServer,
  createTestKeyPair,
  listenOnSocket,
  startFakeService,
  type FakeService
} from '../testing/fakeSparkleService'
import {
  buildCanonicalRequest,
  callService,
  canonicalizeQuery,
  computeKeyId,
  loadServiceAuth,
  requestOverSocket,
  serviceAuthPath,
  serviceSocketPath,
  signServiceRequest,
  type ServiceAuth
} from './serviceSignedRequest'

const FIXED_CLOCK = { now: () => 1_700_000_000_000, nonce: () => 'fixed-nonce' }

function verifyWithPublicKey(
  publicKeyBase64: string,
  canonical: string,
  signature: string
): boolean {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyBase64, 'base64'),
    format: 'der',
    type: 'spki'
  })
  return crypto.verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, 'base64'))
}

describe('canonicalizeQuery', () => {
  const cases: Array<[string, string, string]> = [
    ['empty', '', ''],
    ['sorts keys', '?b=2&a=1', 'a=1&b=2'],
    ['sorts repeated values per key', '?a=2&a=1&b=0', 'a=1&a=2&b=0'],
    ['re-encodes spaces', '?q=a%20b', 'q=a+b'],
    ['keeps empty values', '?flag=&x=1', 'flag=&x=1']
  ]
  for (const [name, input, expected] of cases) {
    it(name, () => {
      assert.equal(canonicalizeQuery(input), expected)
    })
  }
})

describe('computeKeyId', () => {
  it('is the sha256 of the decoded public key, ignoring surrounding whitespace', () => {
    const publicKey = Buffer.from('sparkle-public-key').toString('base64')
    const expected = crypto.createHash('sha256').update('sparkle-public-key').digest('hex')
    assert.equal(computeKeyId(publicKey), expected)
    assert.equal(computeKeyId(`  ${publicKey}\n`), expected)
  })
})

describe('buildCanonicalRequest', () => {
  const base = {
    timestamp: '1700000000000',
    nonce: 'n1',
    keyId: 'kid',
    bodyHash: 'h'
  }

  it('joins the eight V2 fields with newlines and canonicalises the query', () => {
    assert.equal(
      buildCanonicalRequest({ ...base, method: 'post', pathWithQuery: '/core/stop?b=2&a=1&a=0' }),
      [
        'SPARKLE-AUTH-V2',
        '1700000000000',
        'n1',
        'kid',
        'POST',
        '/core/stop',
        'a=0&a=1&b=2',
        'h'
      ].join('\n')
    )
  })

  it('signs the path as sent on the wire (percent-encoded)', () => {
    const id = encodeURIComponent('a b/c')
    assert.equal(
      buildCanonicalRequest({
        ...base,
        method: 'DELETE',
        pathWithQuery: `/connections/${id}`
      }).split('\n')[5],
      '/connections/a%20b%2Fc'
    )
  })
})

describe('signServiceRequest', () => {
  const keyPair = createTestKeyPair()
  const auth: ServiceAuth = { ...keyPair }

  it('emits the V2 header set with the injected clock', () => {
    const headers = signServiceRequest('GET', '/x', Buffer.alloc(0), auth, FIXED_CLOCK)
    assert.deepEqual(Object.keys(headers).sort(), [
      'X-Auth-Version',
      'X-Content-SHA256',
      'X-Key-Id',
      'X-Nonce',
      'X-Signature',
      'X-Timestamp'
    ])
    assert.equal(headers['X-Auth-Version'], '2')
    assert.equal(headers['X-Timestamp'], '1700000000000')
    assert.equal(headers['X-Nonce'], 'fixed-nonce')
    assert.equal(headers['X-Key-Id'], keyPair.keyId)
    assert.equal(headers['X-Content-SHA256'], crypto.createHash('sha256').update('').digest('hex'))
  })

  it('produces a signature that verifies against exactly the canonical request', () => {
    const body = Buffer.from('{"a":1}')
    const headers = signServiceRequest('PUT', '/cfg?force=true', body, auth, FIXED_CLOCK)
    const canonical = buildCanonicalRequest({
      timestamp: '1700000000000',
      nonce: 'fixed-nonce',
      keyId: keyPair.keyId,
      method: 'PUT',
      pathWithQuery: '/cfg?force=true',
      bodyHash: crypto.createHash('sha256').update(body).digest('hex')
    })
    assert.equal(verifyWithPublicKey(keyPair.publicKey, canonical, headers['X-Signature']), true)
    assert.equal(
      verifyWithPublicKey(keyPair.publicKey, `${canonical}x`, headers['X-Signature']),
      false
    )
  })

  it('derives the key id from the public key when the auth file has none', () => {
    const headers = signServiceRequest(
      'GET',
      '/x',
      Buffer.alloc(0),
      { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey },
      FIXED_CLOCK
    )
    assert.equal(headers['X-Key-Id'], keyPair.keyId)
  })

  it('binds the signature to the body, method and path', () => {
    const sign = (method: string, p: string, body: string): string =>
      signServiceRequest(method, p, Buffer.from(body), auth, FIXED_CLOCK)['X-Signature']
    const reference = sign('POST', '/a', 'x')
    // ed25519 签名是确定性的，因此任一输入变化都必须改变签名。
    assert.equal(sign('POST', '/a', 'x'), reference)
    assert.notEqual(sign('POST', '/a', 'y'), reference)
    assert.notEqual(sign('PUT', '/a', 'x'), reference)
    assert.notEqual(sign('POST', '/b', 'x'), reference)
  })

  it('uses a fresh nonce and the wall clock by default', () => {
    const first = signServiceRequest('GET', '/x', Buffer.alloc(0), auth)
    const second = signServiceRequest('GET', '/x', Buffer.alloc(0), auth)
    assert.notEqual(first['X-Nonce'], second['X-Nonce'])
    assert.ok(Math.abs(Date.now() - Number(first['X-Timestamp'])) < 5_000)
  })
})

describe('loadServiceAuth', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true })
      dir = ''
    }
  })

  async function writeAuth(content: string): Promise<string> {
    dir = await mkdtemp(path.join(tmpdir(), 'spk-'))
    const file = path.join(dir, 'auth.json')
    await writeFile(file, content, 'utf8')
    return file
  }

  it('reads the v2 plain envelope the app persists', async () => {
    const keyPair = createTestKeyPair()
    const file = await writeAuth(JSON.stringify({ version: 2, storage: 'plain', ...keyPair }))
    assert.deepEqual(await loadServiceAuth(file), keyPair)
  })

  it('rejects a v1 encrypted envelope that carries no usable keys', async () => {
    const file = await writeAuth(JSON.stringify({ version: 1, ciphertext: 'abc' }))
    await assert.rejects(loadServiceAuth(file), /missing publicKey\/privateKey/)
  })

  it('rejects malformed JSON and a missing file', async () => {
    const file = await writeAuth('{not json')
    await assert.rejects(loadServiceAuth(file), SyntaxError)
    await assert.rejects(loadServiceAuth(`${file}.absent`), { code: 'ENOENT' })
  })
})

describe('socket and auth path resolution', () => {
  it('honours the SPARKLE_SERVICE_* overrides and falls back to the app defaults', () => {
    const saved = {
      socket: process.env.SPARKLE_SERVICE_SOCKET,
      auth: process.env.SPARKLE_SERVICE_AUTH,
      home: process.env.HOME
    }
    try {
      delete process.env.SPARKLE_SERVICE_SOCKET
      delete process.env.SPARKLE_SERVICE_AUTH
      process.env.HOME = '/home/tester'
      assert.equal(serviceSocketPath(), '/tmp/sparkle-service.sock')
      assert.equal(
        serviceAuthPath(),
        '/home/tester/Library/Application Support/sparkle/service-auth.json'
      )
      process.env.SPARKLE_SERVICE_SOCKET = '/tmp/other.sock'
      process.env.SPARKLE_SERVICE_AUTH = '/tmp/other-auth.json'
      assert.equal(serviceSocketPath(), '/tmp/other.sock')
      assert.equal(serviceAuthPath(), '/tmp/other-auth.json')
    } finally {
      for (const [key, value] of Object.entries({
        SPARKLE_SERVICE_SOCKET: saved.socket,
        SPARKLE_SERVICE_AUTH: saved.auth,
        HOME: saved.home
      })) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })
})

describe('callService / requestOverSocket against a signature-verifying fake service', () => {
  let service: FakeService | null = null
  afterEach(async () => {
    await service?.close()
    service = null
  })

  it('sends a signed GET that the service accepts', async () => {
    service = await startFakeService(() => ({ statusCode: 200, body: '{"ok":true}' }))
    const response = await callService({
      method: 'GET',
      pathWithQuery: '/core/controller/connections?b=2&a=1',
      socketPath: service.socketPath,
      authPath: service.authPath
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.toString('utf8'), '{"ok":true}')
    assert.equal(service.requests.length, 1)
    assert.equal(service.requests[0].signatureValid, true)
    assert.equal(service.requests[0].path, '/core/controller/connections?b=2&a=1')
  })

  it('sends a JSON body with a matching content hash', async () => {
    service = await startFakeService()
    const body = Buffer.from('{"path":"","payload":""}')
    const response = await callService({
      method: 'PUT',
      pathWithQuery: '/core/controller/configs?force=true',
      body,
      socketPath: service.socketPath,
      authPath: service.authPath
    })
    assert.equal(response.statusCode, 200)
    assert.equal(service.requests[0].signatureValid, true)
    assert.deepEqual(service.requests[0].body, body)
  })

  it('uses a distinct nonce per call so back-to-back calls are never replays', async () => {
    service = await startFakeService()
    for (let i = 0; i < 3; i += 1) {
      await callService({
        method: 'POST',
        pathWithQuery: '/core/stop',
        socketPath: service.socketPath,
        authPath: service.authPath
      })
    }
    assert.deepEqual(
      service.requests.map((request) => request.signatureValid),
      [true, true, true]
    )
  })

  it('hands non-2xx statuses to the caller instead of throwing', async () => {
    service = await startFakeService(() => ({ statusCode: 500, body: 'boom' }))
    const response = await callService({
      method: 'POST',
      pathWithQuery: '/core/stop',
      socketPath: service.socketPath,
      authPath: service.authPath
    })
    assert.equal(response.statusCode, 500)
    assert.equal(response.body.toString('utf8'), 'boom')
  })

  it('is rejected by the service when signed with a different key', async () => {
    service = await startFakeService()
    const otherAuth = path.join(path.dirname(service.authPath), 'other.json')
    await writeFile(
      otherAuth,
      JSON.stringify({ version: 2, storage: 'plain', ...createTestKeyPair() })
    )
    const response = await callService({
      method: 'POST',
      pathWithQuery: '/core/stop',
      socketPath: service.socketPath,
      authPath: otherAuth
    })
    assert.equal(response.statusCode, 401)
    assert.equal(service.requests[0].signatureValid, false)
  })

  it('rejects when nothing listens on the socket', async () => {
    service = await startFakeService()
    await assert.rejects(
      requestOverSocket({ socketPath: `${service.socketPath}.absent`, method: 'GET', path: '/x' }),
      { code: 'ENOENT' }
    )
  })

  it('rejects with a readable message when the service never answers', async () => {
    service = await startFakeService(() => ({ statusCode: 200, delayMs: 'never' }))
    await assert.rejects(
      callService({
        method: 'GET',
        pathWithQuery: '/slow',
        socketPath: service.socketPath,
        authPath: service.authPath,
        timeoutMs: 150
      }),
      /timed out after 150ms: GET \/slow/
    )
  })

  it('reassembles a response that arrives in several chunks', async () => {
    service = await startFakeService()
    const chunkedSocket = `${service.socketPath}.chunked`
    const server = http.createServer((_req, res) => {
      res.write('hel')
      setTimeout(() => res.end('lo'), 20)
    })
    await listenOnSocket(server, chunkedSocket)
    try {
      const response = await requestOverSocket({
        socketPath: chunkedSocket,
        method: 'GET',
        path: '/'
      })
      assert.equal(response.body.toString('utf8'), 'hello')
    } finally {
      await closeServer(server)
    }
  })
})
