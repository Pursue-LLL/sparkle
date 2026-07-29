import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it } from 'node:test'
import { collectIncidentBundleAtDisconnect } from './incidentBundleCollectorCore'

describe('incidentBundleCollectorCore', () => {
  it('collectIncidentBundleAtDisconnect writes meta and transport rows', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'sparkle-incident-'))
    const sparkleDir = join(baseDir, '.sparkle')
    await mkdir(sparkleDir, { recursive: true })
    const rid = '445ba497-6c23-48e5-b47b-b88555993a4d'
    const transportLine = JSON.stringify({
      ts: Date.now(),
      originalRequestId: rid,
      reasonSub: 'http-sse-server-eof',
      streamPrimarySub: 'server-eof',
    })
    await writeFile(join(sparkleDir, 'agent-transport-failures.jsonl'), `${transportLine}\n`, 'utf8')
    await writeFile(
      join(sparkleDir, 'marathon-segments.v1.jsonl'),
      `${JSON.stringify({
        segmentId: 'seg-1',
        requestId: rid,
        originalRequestId: rid,
        composerId: 'composer-1',
        actionCase: 'userMessageAction',
        httpStartMs: Date.now() - 2_400_000,
        recordedAtMs: Date.now(),
      })}\n`,
      'utf8',
    )

    const outBase = join(baseDir, 'Desktop')
    await mkdir(outBase, { recursive: true })

    const originalHome = process.env.HOME
    process.env.HOME = baseDir
    try {
      const result = await collectIncidentBundleAtDisconnect({
        originalRequestId: rid,
        tsMs: Date.now(),
        reasonSub: 'http-sse-server-eof',
        outBaseDir: outBase,
      })
      assert.ok(result.filesWritten >= 2)
      const metaRaw = await readFile(join(result.bundleDir, 'incident-meta.json'), 'utf8')
      const meta = JSON.parse(metaRaw) as { originalRequestId: string; reasonSub: string }
      assert.equal(meta.originalRequestId, rid)
      assert.equal(meta.reasonSub, 'http-sse-server-eof')
      const transportRaw = await readFile(
        join(result.bundleDir, 'sparkle-agent-transport-by-rid.jsonl'),
        'utf8',
      )
      assert.ok(transportRaw.includes(rid))
    } finally {
      process.env.HOME = originalHome
      await rm(baseDir, { recursive: true, force: true })
    }
  })
})
