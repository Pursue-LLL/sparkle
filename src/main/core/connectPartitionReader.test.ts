import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { agentTransportJsonlPaths, readConnectPartitionSignalAsync } from './connectPartitionReader'

describe('connectPartitionReader paths', () => {
  it('includes sparkle, legacy root, and profile-scoped guard jsonl paths', () => {
    const home = homedir()
    const profileDir = join(home, '.cursor-500-guard', 'profiles', '3.12.17')
    const profileJsonl = join(profileDir, 'agent-transport-failures.jsonl')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(profileJsonl, '', 'utf8')
    try {
      const paths = agentTransportJsonlPaths()
      assert.ok(paths.includes(join(home, '.sparkle', 'agent-transport-failures.jsonl')))
      assert.ok(paths.includes(join(home, '.cursor-500-guard', 'agent-transport-failures.jsonl')))
      assert.ok(paths.includes(profileJsonl))
    } finally {
      rmSync(profileJsonl, { force: true })
    }
  })

  it('detects connect partition from Structured hot tail without jsonl (P17)', async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const home = mkdtempSync(join(tmpdir(), 'sparkle-partition-hot-'))
    const previousHome = process.env.HOME
    process.env.HOME = home
    const cursorRoot = join(home, 'Library', 'Application Support', 'Cursor')
    const structuredPath = join(
      cursorRoot,
      'logs',
      '20260727T120000',
      'window1',
      'exthost',
      'anysphere.cursor-always-local',
      'Cursor Structured Logs.log',
    )
    mkdirSync(join(structuredPath, '..'), { recursive: true })
    const ts = Date.now()
    const stamp = (offsetMs: number): string => {
      const date = new Date(ts + offsetMs)
      const pad = (value: number, len = 2): string => String(value).padStart(len, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    }
    const lineA = `${stamp(0)} [error] {"level":"error","key":"transport","message":"Stream error reported from extension host","metadata":{"error.message":"PING timed out","errorCode":"14","requestId":"rid-a","originalRequestId":"520a4a94-3f18-4e42-a5dd-d7abbd25ed9d"}}`
    const lineB = `${stamp(100)} [error] {"level":"error","key":"transport","message":"Stream error reported from extension host","metadata":{"error.message":"PING timed out","errorCode":"14","requestId":"rid-b","originalRequestId":"520a4a94-3f18-4e42-a5dd-d7abbd25ed9d"}}`
    writeFileSync(structuredPath, `${lineA}\n${lineB}\n`, 'utf8')
    try {
      const result = await readConnectPartitionSignalAsync(50, ts + 200, [cursorRoot])
      assert.ok(result.signal)
      assert.ok((result.signal?.pingFailureCount ?? 0) >= 2)
      assert.ok(result.signal?.sampleRequestIds.includes('520a4a94-3f18-4e42-a5dd-d7abbd25ed9d'))
      assert.equal(result.mergedRows.length, 2)
    } finally {
      process.env.HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    }
  })
})
