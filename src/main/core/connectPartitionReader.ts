// [INPUT] connectPartitionDetectCore::detectConnectPartitionSignal (POS: Connect mass-PING 窗口检测)
// [OUTPUT] readConnectPartitionSignal: 近窗 transport failure 行 → ConnectPartitionSignal
// [POS] Sparkle hung_scan 读 agent-transport-failures.jsonl（~/.sparkle · guard root · guard profiles/*）。

import { existsSync, openSync, readSync, closeSync, statSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  CONNECT_PARTITION_WINDOW_MS,
  detectConnectPartitionSignal,
  type AgentTransportFailureRow,
  type ConnectPartitionSignal,
} from './connectPartitionDetectCore'

const GUARD_LEGACY_ROOT_DIR = join(homedir(), '.cursor-500-guard')
const SPARKLE_AGENT_TRANSPORT_PATH = join(homedir(), '.sparkle', 'agent-transport-failures.jsonl')
const GUARD_AGENT_TRANSPORT_PATH = join(GUARD_LEGACY_ROOT_DIR, 'agent-transport-failures.jsonl')
const GUARD_PROFILES_DIR = join(GUARD_LEGACY_ROOT_DIR, 'profiles')
const JSONL_TAIL_BYTES = 512_000

/** Mirror Guard `agentTransportFailurePaths()` read side: sparkle + legacy root + per-profile dirs. */
export function agentTransportJsonlPaths(): string[] {
  const paths = new Set<string>([SPARKLE_AGENT_TRANSPORT_PATH, GUARD_AGENT_TRANSPORT_PATH])
  if (existsSync(GUARD_PROFILES_DIR)) {
    for (const entry of readdirSync(GUARD_PROFILES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      paths.add(join(GUARD_PROFILES_DIR, entry.name, 'agent-transport-failures.jsonl'))
    }
  }
  return [...paths]
}

function readJsonlTail(filePath: string): AgentTransportFailureRow[] {
  if (!existsSync(filePath)) {
    return []
  }
  try {
    const stat = statSync(filePath)
    const start = Math.max(0, stat.size - JSONL_TAIL_BYTES)
    const fd = openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(stat.size - start)
      readSync(fd, buf, 0, buf.length, start)
      const rows: AgentTransportFailureRow[] = []
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.trim()) {
          continue
        }
        try {
          rows.push(JSON.parse(line) as AgentTransportFailureRow)
        } catch {
          continue
        }
      }
      return rows
    } finally {
      closeSync(fd)
    }
  } catch {
    return []
  }
}

/** Read recent Guard/Sparkle transport failure rows for Connect split-brain detection. */
export function readConnectPartitionSignal(
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
): ConnectPartitionSignal | undefined {
  const rows: AgentTransportFailureRow[] = []
  for (const filePath of agentTransportJsonlPaths()) {
    rows.push(...readJsonlTail(filePath))
  }
  return detectConnectPartitionSignal(rows, {
    nowMs,
    cursorConnectionCount,
    windowMs: CONNECT_PARTITION_WINDOW_MS,
  })
}
