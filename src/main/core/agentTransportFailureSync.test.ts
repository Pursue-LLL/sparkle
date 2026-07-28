import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, it } from 'node:test'
import {
  resetAgentTransportFailureSyncForTests,
  resolveCursorDataDirs,
  syncAgentTransportFailuresFromCursorLogs,
} from './agentTransportFailureSync'
import { listCursorLogSessionDirs } from './cursorLogDiscoveryCore'

const ORIGINAL_HOME = process.env.HOME

describe('agentTransportFailureSync', () => {
  afterEach(() => {
    resetAgentTransportFailureSyncForTests()
    process.env.HOME = ORIGINAL_HOME
  })

  it('listCursorLogSessionDirs skips dotfiles and non-directory entries (BUG-021)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sparkle-log-session-dirs-'))
    const logsDir = join(home, 'logs')
    const validSession = join(logsDir, '20260728T104341', 'window1')
    await mkdir(validSession, { recursive: true })
    await writeFile(join(logsDir, '.DS_Store'), 'fake ds store', 'utf8')
    await writeFile(join(logsDir, 'orphan-file.log'), 'not a session dir', 'utf8')

    const sessions = await listCursorLogSessionDirs(logsDir)
    assert.deepEqual(sessions, ['20260728T104341'])

    await rm(home, { recursive: true, force: true })
  })

  it('writes PING failure from renderer log to sparkle jsonl with proxyNode fallback', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sparkle-transport-sync-'))
    process.env.HOME = home
    const cursorDataDir = join(home, 'Library', 'Application Support', 'Cursor-3.1.15-data')
    const rendererPath = join(cursorDataDir, 'logs', '20260721T120000', 'window1', 'renderer.log')
    await mkdir(dirname(rendererPath), { recursive: true })
    const ts = 1_784_601_353_983
    await writeFile(
      rendererPath,
      `2026-07-20 14:56:53.983 [info] [ifm-patch-99 transport-failure] kind="agent_transport_failure" ts=${ts} requestId="rid-sync-1" originalRequestId="rid-sync-1" composerId="cid-1" proxyNode="" reasonType="proxy-network" reasonSub="dial-timeout" errMsg="[unavailable] PING timed out" connectCode="14" attempt=0 activeAgents=2\n`,
      'utf8',
    )

    const written = await syncAgentTransportFailuresFromCursorLogs({
      sinceMs: ts - 60_000,
      proxyNodeFallback: 'JP-VPS-HY2',
      cursorDataDirs: [cursorDataDir],
      logWrites: false,
    })
    assert.equal(written, 1)

    const jsonlPath = join(home, '.sparkle', 'agent-transport-failures.jsonl')
    const text = await readFile(jsonlPath, 'utf8')
    const row = JSON.parse(text.trim()) as Record<string, unknown>
    assert.equal(row.requestId, 'rid-sync-1')
    assert.equal(row.proxyNode, 'JP-VPS-HY2')
    assert.equal(row.source, 'sparkle-sync')

    const secondPass = await syncAgentTransportFailuresFromCursorLogs({
      sinceMs: ts - 60_000,
      proxyNodeFallback: 'JP-VPS-HY2',
      cursorDataDirs: [cursorDataDir],
      logWrites: false,
    })
    assert.equal(secondPass, 0)

    await rm(home, { recursive: true, force: true })
  })

  it('resolveCursorDataDirs maps app prefixes and includes known daily cursor dirs', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sparkle-transport-dirs-'))
    process.env.HOME = home
    const dailyDir = join(home, 'Library', 'Application Support', 'Cursor-3.1.15-data')
    const customDir = join(home, 'Library', 'Application Support', 'Cursor-custom-data')
    await mkdir(join(dailyDir, 'logs'), { recursive: true })
    await mkdir(join(customDir, 'logs'), { recursive: true })

    const dirs = await resolveCursorDataDirs({
      appPathPrefixes: ['/Applications/Cursor-custom.app'],
    })

    assert.ok(dirs.includes(dailyDir))
    assert.ok(dirs.includes(customDir))
    assert.ok(!dirs.some((dir) => dir.includes('Cursor-2-data')))

    await rm(home, { recursive: true, force: true })
  })

  it('syncs stock renderer ConnectError JSON from renderer log', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sparkle-transport-stock-'))
    process.env.HOME = home
    const cursorDataDir = join(home, 'Library', 'Application Support', 'Cursor-3.1.15-data')
    const rendererPath = join(cursorDataDir, 'logs', '20260721T120000', 'window1', 'renderer.log')
    await mkdir(dirname(rendererPath), { recursive: true })
    const ts = Date.parse('2026-07-21T11:26:14.272')
    await writeFile(
      rendererPath,
      `2026-07-21 11:26:14.272 [error] An unknown error occurred. Please consult the log for more details. {"name":"ConnectError","rawMessage":"read ETIMEDOUT","code":14,"metadata":{},"details":[],"cause":{"errno":-60,"code":"ETIMEDOUT","syscall":"read"}}\n`,
      'utf8',
    )

    const written = await syncAgentTransportFailuresFromCursorLogs({
      sinceMs: ts - 60_000,
      proxyNodeFallback: 'JP-VPS-HY2',
      cursorDataDirs: [cursorDataDir],
      logWrites: false,
    })
    assert.equal(written, 1)

    const jsonlPath = join(home, '.sparkle', 'agent-transport-failures.jsonl')
    const row = JSON.parse((await readFile(jsonlPath, 'utf8')).trim()) as Record<string, unknown>
    assert.equal(row.reasonSub, 'read-timeout')
    assert.equal(row.connectCode, '14')
    assert.equal(row.source, 'sparkle-sync')

    await rm(home, { recursive: true, force: true })
  })

  it('syncs network diagnostic ConnectError from structured log', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sparkle-transport-structured-'))
    process.env.HOME = home
    const cursorDataDir = join(home, 'Library', 'Application Support', 'Cursor-3.1.15-data')
    const structuredPath = join(
      cursorDataDir,
      'logs',
      '20260727T120000',
      'window1',
      'exthost',
      'anysphere.cursor-always-local',
      'Cursor Structured Logs.log',
    )
    await mkdir(dirname(structuredPath), { recursive: true })
    const ts = Date.parse('2026-07-27T17:57:15.272')
    await writeFile(
      structuredPath,
      `2026-07-27 17:57:15.272 [error] Cursor Network Diagnostic agent ping {"name":"ConnectError","rawMessage":"[unavailable] PING timed out","code":14}\n`,
      'utf8',
    )

    const written = await syncAgentTransportFailuresFromCursorLogs({
      sinceMs: ts - 60_000,
      proxyNodeFallback: 'JP-VPS-HY2',
      cursorDataDirs: [cursorDataDir],
      logWrites: false,
    })
    assert.equal(written, 1)

    const jsonlPath = join(home, '.sparkle', 'agent-transport-failures.jsonl')
    const row = JSON.parse((await readFile(jsonlPath, 'utf8')).trim()) as Record<string, unknown>
    assert.equal(row.kind, 'network_diagnostic_ping_storm')
    assert.equal(row.connectCode, '14')

    await rm(home, { recursive: true, force: true })
  })

  it('syncs NAL Stream error from stock Cursor/logs root (P17)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sparkle-transport-stock-cursor-'))
    process.env.HOME = home
    const cursorDataDir = join(home, 'Library', 'Application Support', 'Cursor')
    const structuredPath = join(
      cursorDataDir,
      'logs',
      '20260727T094224',
      'window1',
      'exthost',
      'anysphere.cursor-always-local',
      'Cursor Structured Logs.log',
    )
    await mkdir(dirname(structuredPath), { recursive: true })
    const ts = Date.parse('2026-07-27T17:42:12.698')
    await writeFile(
      structuredPath,
      `2026-07-27 17:42:12.698 [error] {"level":"error","key":"transport","message":"Stream error reported from extension host","metadata":{"error.message":"PING timed out","errorCode":"14","requestId":"e67c9ec5-754c-46cd-834e-36eaebecdc40","originalRequestId":"520a4a94-3f18-4e42-a5dd-d7abbd25ed9d"}}\n`,
      'utf8',
    )

    const written = await syncAgentTransportFailuresFromCursorLogs({
      sinceMs: ts - 60_000,
      proxyNodeFallback: 'JP-VPS-HY2',
      cursorDataDirs: [cursorDataDir],
      logWrites: false,
    })
    assert.equal(written, 1)

    const jsonlPath = join(home, '.sparkle', 'agent-transport-failures.jsonl')
    const row = JSON.parse((await readFile(jsonlPath, 'utf8')).trim()) as Record<string, unknown>
    assert.equal(row.originalRequestId, '520a4a94-3f18-4e42-a5dd-d7abbd25ed9d')
    assert.equal(row.connectCode, '14')

    await rm(home, { recursive: true, force: true })
  })
})
