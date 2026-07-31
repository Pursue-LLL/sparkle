import axios from 'axios'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'

const SERVICE_SOCKET = '/tmp/sparkle-service.sock'
const CONTROLLER_BASE = 'http://localhost/core/controller'

function canonicalizeQuery(urlObj) {
  const source = new URLSearchParams(urlObj.search)
  const keys = Array.from(new Set(source.keys())).sort()
  const target = new URLSearchParams()
  for (const key of keys) {
    for (const value of source.getAll(key).sort()) {
      target.append(key, value)
    }
  }
  return target.toString()
}

function computeKeyId(publicKeyBase64) {
  return crypto.createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex')
}

function signRequest(method, pathWithQuery, body, auth) {
  const urlObj = new URL(pathWithQuery, 'http://localhost')
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex')
  const timestamp = Date.now().toString()
  const nonce = crypto.randomBytes(16).toString('base64url')
  const keyId = auth.keyId || computeKeyId(auth.publicKey)
  const canonical = [
    'SPARKLE-AUTH-V2',
    timestamp,
    nonce,
    keyId,
    method.toUpperCase(),
    urlObj.pathname || '/',
    canonicalizeQuery(urlObj),
    bodyHash
  ].join('\n')

  const keyObject = crypto.createPrivateKey({ key: auth.privateKey, format: 'pem' })
  const signature = crypto.sign(null, Buffer.from(canonical), keyObject).toString('base64')
  return {
    'Content-Type': 'application/json',
    'X-Auth-Version': '2',
    'X-Key-Id': keyId,
    'X-Nonce': nonce,
    'X-Content-SHA256': bodyHash,
    'X-Timestamp': timestamp,
    'X-Signature': signature
  }
}

async function main() {
  const authPath = `${process.env.HOME}/Library/Application Support/sparkle/service-auth.json`
  const auth = JSON.parse(await readFile(authPath, 'utf8'))

  const pathWithQuery = '/core/controller/configs?force=true'
  const body = Buffer.from(JSON.stringify({ path: '', payload: '' }))
  const headers = signRequest('PUT', pathWithQuery, body, auth)

  await axios.put(`http://localhost${pathWithQuery}`, body, {
    headers,
    socketPath: SERVICE_SOCKET,
    timeout: 30_000,
    transformRequest: [(data) => data]
  })

  console.log('reload_ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
