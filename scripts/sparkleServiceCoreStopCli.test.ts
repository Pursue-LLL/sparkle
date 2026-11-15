import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startFakeService, type FakeService } from './testing/fakeSparkleService'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TSX = path.join(ROOT, 'node_modules/.bin/tsx')
const CLI = path.join(ROOT, 'scripts/sparkle-service-core-stop.mts')

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

function runCli(env: Record<string, string>): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

describe('sparkle-service-core-stop CLI', () => {
  let service: FakeService | null = null
  let scratch = ''

  afterEach(async () => {
    await service?.close()
    service = null
    if (scratch) {
      await rm(scratch, { recursive: true, force: true })
      scratch = ''
    }
  })

  it('exits 0 and says there is nothing to stop when the service is not installed', async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'spk-'))
    const result = await runCli({
      SPARKLE_SERVICE_SOCKET: path.join(scratch, 'none.sock'),
      SPARKLE_SERVICE_AUTH: path.join(scratch, 'auth.json')
    })
    assert.equal(result.code, 0)
    assert.match(result.stdout, /\[core-stop\] nothing to stop: service socket not found/)
  })

  it('exits 0 after the service accepted a signed /core/stop', async () => {
    service = await startFakeService()
    const result = await runCli({
      SPARKLE_SERVICE_SOCKET: service.socketPath,
      SPARKLE_SERVICE_AUTH: service.authPath
    })
    assert.equal(result.code, 0)
    assert.match(result.stdout, /\[core-stop\] service core stopped \(HTTP 200\)/)
    assert.deepEqual(
      service.requests.map(({ method, path: p, signatureValid }) => [method, p, signatureValid]),
      [['POST', '/core/stop', true]]
    )
  })

  it('exits 2 and reports the failure when the service refuses to stop the core', async () => {
    service = await startFakeService(() => ({ statusCode: 500 }))
    const result = await runCli({
      SPARKLE_SERVICE_SOCKET: service.socketPath,
      SPARKLE_SERVICE_AUTH: service.authPath
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /\[core-stop\] FAILED: service answered HTTP 500/)
  })

  it('exits 2 within the configured timeout when the service hangs', async () => {
    service = await startFakeService(() => ({ statusCode: 200, delayMs: 'never' }))
    const startedAt = Date.now()
    const result = await runCli({
      SPARKLE_SERVICE_SOCKET: service.socketPath,
      SPARKLE_SERVICE_AUTH: service.authPath,
      SPARKLE_CORE_STOP_TIMEOUT_MS: '300'
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /timed out after 300ms/)
    assert.ok(Date.now() - startedAt < 8_000, 'must not wait for the default 10s timeout')
  })

  it('ignores a nonsensical timeout override instead of failing', async () => {
    service = await startFakeService()
    const result = await runCli({
      SPARKLE_SERVICE_SOCKET: service.socketPath,
      SPARKLE_SERVICE_AUTH: service.authPath,
      SPARKLE_CORE_STOP_TIMEOUT_MS: 'abc'
    })
    assert.equal(result.code, 0)
  })
})
