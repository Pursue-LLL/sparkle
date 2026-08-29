import axios from 'axios'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SERVICE_SOCKET = '/tmp/sparkle-service.sock'
const GUARD_STATE_PATH = join(homedir(), '.sparkle/marathon-core-restart-guard.json')

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

function shouldDeferFromGuardPayload(payload) {
  if (payload?.blockColdRestart === true) {
    return true
  }
  const cursorConn = payload?.cursorConnectionCount
  if (typeof cursorConn === 'number' && cursorConn > 0) {
    return true
  }
  if (payload?.quiesceActive === true) {
    return true
  }
  const lifecycle = payload?.recentActiveLifecycleStreamCount
  if (typeof lifecycle === 'number' && lifecycle > 0) {
    return true
  }
  if (cursorConn === -1 || lifecycle === -1) {
    return true
  }
  return false
}

async function readGuardDeferDecision() {
  try {
    const raw = await readFile(GUARD_STATE_PATH, 'utf8')
    const payload = JSON.parse(raw)
    return { defer: shouldDeferFromGuardPayload(payload), payload }
  } catch {
    return { defer: false, payload: null }
  }
}

async function main() {
  const guard = await readGuardDeferDecision()
  if (guard.defer) {
    console.log('reload_deferred', guard.payload ?? { reason: 'guard_state_unreadable_fail_open' })
    process.exit(0)
  }

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
