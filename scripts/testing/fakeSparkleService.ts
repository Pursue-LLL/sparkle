// [INPUT] scripts/lib/serviceSignedRequest.ts::buildCanonicalRequest / computeKeyId (POS: 脚本侧 SPARKLE-AUTH-V2
//         签名的唯一实现，规范串与 keyId 推导以它为准)
// [OUTPUT] TestKeyPair · createTestKeyPair · FakeService · startFakeService · RecordedRequest · ServiceReply ·
//          ServiceResponder · listenOnSocket · closeServer
// [POS] 测试专用：unix socket 上的假 sparkle-service，逐请求校验 SPARKLE-AUTH-V2（版本、keyId、
// 体哈希、时间窗、nonce 不可重放、ed25519 签名），并记录请求供断言。

import crypto from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildCanonicalRequest, computeKeyId } from '../lib/serviceSignedRequest'

const TIMESTAMP_WINDOW_MS = 60_000

/** 与 App 持久化的服务鉴权密钥同形：公钥为去掉 PEM 头尾的 SPKI base64，私钥为 PKCS8 PEM。 */
export interface TestKeyPair {
  keyId: string
  publicKey: string
  privateKey: string
}

export function createTestKeyPair(): TestKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  const publicKeyBase64 = publicKey
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '')
  return { keyId: computeKeyId(publicKeyBase64), publicKey: publicKeyBase64, privateKey }
}

export interface RecordedRequest {
  method: string
  path: string
  body: Buffer
  signatureValid: boolean
}

export interface ServiceReply {
  statusCode: number
  body?: string
  /** `never`：收到请求后永不应答，用来制造超时。 */
  delayMs?: number | 'never'
}

export type ServiceResponder = (request: RecordedRequest) => ServiceReply

export interface FakeService {
  socketPath: string
  authPath: string
  keyPair: TestKeyPair
  requests: RecordedRequest[]
  setResponder: (responder: ServiceResponder) => void
  close: () => Promise<void>
}

function header(req: http.IncomingMessage, name: string): string {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : (value ?? '')
}

function verifySignature(
  req: http.IncomingMessage,
  body: Buffer,
  keyPair: TestKeyPair,
  seenNonces: Set<string>
): boolean {
  const nonce = header(req, 'X-Nonce')
  const timestamp = header(req, 'X-Timestamp')
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex')
  const fresh = Math.abs(Date.now() - Number(timestamp)) <= TIMESTAMP_WINDOW_MS
  const replayed = seenNonces.has(nonce)
  seenNonces.add(nonce)

  if (
    header(req, 'X-Auth-Version') !== '2' ||
    header(req, 'X-Key-Id') !== keyPair.keyId ||
    header(req, 'X-Content-SHA256') !== bodyHash ||
    !fresh ||
    replayed ||
    nonce === ''
  ) {
    return false
  }

  const canonical = buildCanonicalRequest({
    timestamp,
    nonce,
    keyId: keyPair.keyId,
    method: req.method ?? '',
    pathWithQuery: req.url ?? '/',
    bodyHash
  })
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(keyPair.publicKey, 'base64'),
    format: 'der',
    type: 'spki'
  })
  return crypto.verify(
    null,
    Buffer.from(canonical),
    publicKey,
    Buffer.from(header(req, 'X-Signature'), 'base64')
  )
}

export function listenOnSocket(server: http.Server, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    server.listen(socketPath, resolve)
  })
}

export function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

export async function startFakeService(
  responder: ServiceResponder = () => ({ statusCode: 200, body: '{}' })
): Promise<FakeService> {
  const dir = await mkdtemp(path.join(tmpdir(), 'spk-'))
  const socketPath = path.join(dir, 's.sock')
  const authPath = path.join(dir, 'service-auth.json')
  const keyPair = createTestKeyPair()
  await writeFile(authPath, JSON.stringify({ version: 2, storage: 'plain', ...keyPair }), 'utf8')

  const requests: RecordedRequest[] = []
  const seenNonces = new Set<string>()
  let currentResponder = responder

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        path: req.url ?? '/',
        body,
        signatureValid: verifySignature(req, body, keyPair, seenNonces)
      }
      requests.push(recorded)
      const reply = recorded.signatureValid
        ? currentResponder(recorded)
        : { statusCode: 401, body: '{"error":"unauthorized"}' }
      if (reply.delayMs === 'never') {
        return
      }
      setTimeout(() => res.writeHead(reply.statusCode).end(reply.body ?? ''), reply.delayMs ?? 0)
    })
  })
  await listenOnSocket(server, socketPath)

  return {
    socketPath,
    authPath,
    keyPair,
    requests,
    setResponder: (next) => {
      currentResponder = next
    },
    close: async () => {
      await closeServer(server)
      await rm(dir, { recursive: true, force: true })
    }
  }
}
