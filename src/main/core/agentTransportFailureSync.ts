// [INPUT] agentTransportFailureWriterCore · resolveCursorDedicatedActiveNode
// [OUTPUT] syncAgentTransportFailuresFromCursorLogs · startAgentTransportFailureSync
// [POS] Sparkle-side bridge: Cursor logs → ~/.sparkle/agent-transport-failures.jsonl

import { appendFile, mkdir, open, readFile, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, join } from 'path'
import { homedir } from 'os'
import {
  parseTransportFailureLine,
  rowDedupeKey,
  shouldPersistTransportFailure,
  type AgentTransportFailureRow,
} from './agentTransportFailureWriterCore'

const RENDERER_TAIL_BYTES = 2_000_000
const EXTHOST_TAIL_BYTES = 512_000
const SYNC_OVERLAP_MS = 120_000
const MAX_LOG_SESSIONS = 6

function sparkleAgentTransportPath(): string {
  return join(homedir(), '.sparkle', 'agent-transport-failures.jsonl')
}

let lastSyncFinishedAtMs = 0
let syncInFlight = false
let syncBootstrapped = false

function cursorDataDirFromAppPrefix(appPrefix: string): string {
  const appName = basename(appPrefix.trim())
  const stem = appName.endsWith('.app') ? appName.slice(0, -4) : appName
  return join(homedir(), 'Library', 'Application Support', `${stem}-data`)
}

export async function resolveCursorDataDirs(options?: {
  appPathPrefixes?: string[]
}): Promise<string[]> {
  const cursorProxyAppPathPrefixes =
    options?.appPathPrefixes ??
    (await (await import('../config/app')).getAppConfig()).cursorProxyAppPathPrefixes ??
    []
  const dirs = new Set<string>()
  for (const prefix of cursorProxyAppPathPrefixes) {
    if (prefix.trim()) {
      dirs.add(cursorDataDirFromAppPrefix(prefix))
    }
  }
  dirs.add(join(homedir(), 'Library', 'Application Support', 'Cursor-3.1.15-data'))
  dirs.add(join(homedir(), 'Library', 'Application Support', 'Cursor-data'))
  dirs.add(join(homedir(), 'Library', 'Application Support', 'Cursor-2-data'))
  return [...dirs].filter((dir) => existsSync(dir))
}

export async function listRendererLogFiles(cursorDataDir: string): Promise<string[]> {
  const logsDir = join(cursorDataDir, 'logs')
  if (!existsSync(logsDir)) {
    return []
  }
  const sessions = (await readdir(logsDir))
    .filter((name) => existsSync(join(logsDir, name)))
    .sort()
    .slice(-Math.max(1, MAX_LOG_SESSIONS))
  const files: string[] = []
  for (const session of sessions) {
    const root = join(logsDir, session)
    const entries = await readdir(root)
    for (const entry of entries) {
      const windowDir = join(root, entry)
      if (!existsSync(windowDir) || !(await stat(windowDir)).isDirectory()) {
        continue
      }
      for (const file of await readdir(windowDir)) {
        if (/^renderer(\.\d+)?\.log$/.test(file)) {
          files.push(join(windowDir, file))
        }
        if (file === 'exthost.log') {
          files.push(join(windowDir, file))
        }
      }
    }
  }
  return [...new Set(files)]
}

const STRUCTURED_LOG_RELATIVE = join(
  'exthost',
  'anysphere.cursor-always-local',
  'Cursor Structured Logs.log',
)

export async function listCursorStructuredLogFiles(cursorDataDir: string): Promise<string[]> {
  const logsDir = join(cursorDataDir, 'logs')
  if (!existsSync(logsDir)) {
    return []
  }
  const sessions = (await readdir(logsDir))
    .filter((name) => existsSync(join(logsDir, name)))
    .sort()
    .slice(-Math.max(1, MAX_LOG_SESSIONS))
  const files: string[] = []
  for (const session of sessions) {
    const root = join(logsDir, session)
    const entries = await readdir(root)
    for (const entry of entries) {
      const windowDir = join(root, entry)
      if (!existsSync(windowDir) || !(await stat(windowDir)).isDirectory()) {
        continue
      }
      const structuredPath = join(windowDir, STRUCTURED_LOG_RELATIVE)
      if (existsSync(structuredPath)) {
        files.push(structuredPath)
      }
    }
  }
  return [...new Set(files)]
}

export async function readLogFileTail(filePath: string, maxBytes: number): Promise<string> {
  const fileStat = await stat(filePath)
  const start = Math.max(0, fileStat.size - maxBytes)
  const handle = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(fileStat.size - start)
    await handle.read(buf, 0, buf.length, start)
    return buf.toString('utf8')
  } finally {
    await handle.close()
  }
}

async function loadExistingDedupeKeys(sinceMs: number): Promise<Set<string>> {
  const keys = new Set<string>()
  const jsonlPath = sparkleAgentTransportPath()
  if (!existsSync(jsonlPath)) {
    return keys
  }
  const text = await readFile(jsonlPath, 'utf8')
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue
    }
    try {
      const raw = JSON.parse(line) as Record<string, unknown>
      const ts = typeof raw.ts === 'number' ? raw.ts : Number(raw.ts)
      if (!Number.isFinite(ts) || ts < sinceMs) {
        continue
      }
      keys.add(rowDedupeKey({ ts, requestId: String(raw.requestId ?? '') || undefined }))
    } catch {
      continue
    }
  }
  return keys
}

export async function appendAgentTransportFailureRow(
  row: AgentTransportFailureRow,
  proxyNodeFallback?: string,
): Promise<void> {
  const payload = {
    kind: 'agent_transport_failure',
    ts: row.ts,
    requestId: row.requestId ?? '',
    originalRequestId: row.originalRequestId ?? row.requestId ?? '',
    composerId: row.composerId ?? '',
    proxyNode: row.proxyNode?.trim() || proxyNodeFallback || '',
    reasonType: row.reasonType ?? 'proxy-network',
    reasonSub: row.reasonSub ?? 'transport',
    errMsg: row.errMsg ?? '',
    connectCode: row.connectCode ?? '',
    attempt: row.attempt ?? 0,
    ...(row.activeAgents !== undefined ? { activeAgents: row.activeAgents } : {}),
    source: 'sparkle-sync',
  }
  await mkdir(join(homedir(), '.sparkle'), { recursive: true })
  await appendFile(sparkleAgentTransportPath(), `${JSON.stringify(payload)}\n`, 'utf8')
}

export async function syncAgentTransportFailuresFromCursorLogs(options?: {
  sinceMs?: number
  proxyNodeFallback?: string
  cursorDataDirs?: string[]
  logWrites?: boolean
}): Promise<number> {
  if (syncInFlight) {
    return 0
  }
  syncInFlight = true
  try {
    const sinceMs =
      options?.sinceMs ??
      Math.max(0, (lastSyncFinishedAtMs || Date.now()) - SYNC_OVERLAP_MS)
    const seen = await loadExistingDedupeKeys(sinceMs)
    let written = 0
    const cursorDataDirs = options?.cursorDataDirs ?? (await resolveCursorDataDirs())
    for (const cursorDataDir of cursorDataDirs) {
      for (const filePath of await listRendererLogFiles(cursorDataDir)) {
        const tailBytes = filePath.endsWith('exthost.log')
          ? EXTHOST_TAIL_BYTES
          : RENDERER_TAIL_BYTES
        const text = await readLogFileTail(filePath, tailBytes)
        for (const line of text.split('\n')) {
          const candidate = parseTransportFailureLine(line)
          if (!candidate || candidate.ts < sinceMs || !shouldPersistTransportFailure(candidate)) {
            continue
          }
          const key = rowDedupeKey(candidate)
          if (seen.has(key)) {
            continue
          }
          seen.add(key)
          await appendAgentTransportFailureRow(candidate, options?.proxyNodeFallback)
          written += 1
        }
      }
    }
    lastSyncFinishedAtMs = Date.now()
    if (written > 0 && options?.logWrites !== false) {
      try {
        const { appendAppLog } = await import('../utils/log')
        await appendAppLog(
          `[AgentTransportFailureSync]: wrote ${written} row(s) → ${sparkleAgentTransportPath()}\n`,
        )
      } catch {
        // Logging is best-effort; jsonl write is authoritative.
      }
    }
    return written
  } finally {
    syncInFlight = false
  }
}

export function startAgentTransportFailureSync(): void {
  if (syncBootstrapped) {
    return
  }
  syncBootstrapped = true
  // Periodic sync is driven by cursorTransportHealth hung_scan (same 30s cadence).
  void (async () => {
    const { resolveCursorDedicatedActiveNode } = await import('./cursorHy2MarathonKeepalive')
    const proxyNode = await resolveCursorDedicatedActiveNode()
    await syncAgentTransportFailuresFromCursorLogs({ proxyNodeFallback: proxyNode })
  })()
}

export function stopAgentTransportFailureSync(): void {
  syncBootstrapped = false
}

export function resetAgentTransportFailureSyncForTests(): void {
  stopAgentTransportFailureSync()
  lastSyncFinishedAtMs = 0
  syncInFlight = false
}
