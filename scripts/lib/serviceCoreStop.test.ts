import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  createTestKeyPair,
  startFakeService,
  type FakeService
} from '../testing/fakeSparkleService'
import { stopServiceCore } from './serviceCoreStop'

describe('stopServiceCore', () => {
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

  async function scratchDir(): Promise<string> {
    scratch = await mkdtemp(path.join(tmpdir(), 'spk-'))
    return scratch
  }

  it('reports service-absent when there is no service socket', async () => {
    const dir = await scratchDir()
    const outcome = await stopServiceCore({
      socketPath: path.join(dir, 'missing.sock'),
      authPath: path.join(dir, 'auth.json')
    })
    assert.deepEqual(outcome, { kind: 'service-absent', reason: 'service socket not found' })
  })

  it('posts a signed, body-less /core/stop and reports stopped on 200', async () => {
    service = await startFakeService(() => ({ statusCode: 200, body: '{}' }))
    const outcome = await stopServiceCore({
      socketPath: service.socketPath,
      authPath: service.authPath
    })
    assert.deepEqual(outcome, { kind: 'stopped', statusCode: 200 })
    assert.equal(service.requests.length, 1)
    assert.equal(service.requests[0].method, 'POST')
    assert.equal(service.requests[0].path, '/core/stop')
    assert.equal(service.requests[0].body.length, 0)
    assert.equal(service.requests[0].signatureValid, true)
  })

  it('treats any 2xx as stopped', async () => {
    service = await startFakeService(() => ({ statusCode: 204 }))
    const outcome = await stopServiceCore({
      socketPath: service.socketPath,
      authPath: service.authPath
    })
    assert.deepEqual(outcome, { kind: 'stopped', statusCode: 204 })
  })

  it('fails when the service answers with an error status', async () => {
    service = await startFakeService(() => ({ statusCode: 500, body: 'boom' }))
    const outcome = await stopServiceCore({
      socketPath: service.socketPath,
      authPath: service.authPath
    })
    assert.deepEqual(outcome, { kind: 'failed', reason: 'service answered HTTP 500' })
  })

  it('fails (not service-absent) when the service rejects our signature', async () => {
    service = await startFakeService()
    const dir = await scratchDir()
    const foreignAuth = path.join(dir, 'foreign.json')
    await writeFile(
      foreignAuth,
      JSON.stringify({ version: 2, storage: 'plain', ...createTestKeyPair() })
    )
    const outcome = await stopServiceCore({ socketPath: service.socketPath, authPath: foreignAuth })
    assert.deepEqual(outcome, { kind: 'failed', reason: 'service answered HTTP 401' })
  })

  it('fails when the service is running but the auth key file cannot be found', async () => {
    service = await startFakeService()
    const dir = await scratchDir()
    const outcome = await stopServiceCore({
      socketPath: service.socketPath,
      authPath: path.join(dir, 'nope.json')
    })
    assert.equal(outcome.kind, 'failed')
    assert.match(outcome.kind === 'failed' ? outcome.reason : '', /auth key file is missing/)
  })

  it('fails with the parse error when the auth file is corrupt', async () => {
    service = await startFakeService()
    const dir = await scratchDir()
    const corrupt = path.join(dir, 'corrupt.json')
    await writeFile(corrupt, '{oops')
    const outcome = await stopServiceCore({ socketPath: service.socketPath, authPath: corrupt })
    assert.equal(outcome.kind, 'failed')
  })

  it('fails when the service accepts the connection but never answers', async () => {
    service = await startFakeService(() => ({ statusCode: 200, delayMs: 'never' }))
    const outcome = await stopServiceCore({
      socketPath: service.socketPath,
      authPath: service.authPath,
      timeoutMs: 150
    })
    assert.equal(outcome.kind, 'failed')
    assert.match(outcome.kind === 'failed' ? outcome.reason : '', /timed out after 150ms/)
  })

  it('reports service-absent for a stale socket file nobody listens on', async () => {
    service = await startFakeService()
    const dir = await scratchDir()
    const stale = path.join(dir, 'stale.sock')
    await writeFile(stale, '')
    const outcome = await stopServiceCore({ socketPath: stale, authPath: service.authPath })
    assert.equal(outcome.kind, 'service-absent')
  })
})
