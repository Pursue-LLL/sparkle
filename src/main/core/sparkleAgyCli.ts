// [INPUT] 官方 agy CLI（~/.local/bin/agy，keychain 登录）· 探测专用干净目录
// [OUTPUT] AGY_PROBE_MODEL · requestNativeAgy · NativeAgyResponse
// [POS] 跑一次官方 agy CLI 的真实请求，把输出归类成 HTTP 状态：地区被拒 → 400，退出码 0 → 200，登录问题 → 403，其余 → 500。
// 干净目录不加载用户的 skills / MCP / 全局规则（34k → 6.9k input），同时保留官方客户端的全部请求特征。

import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { copyFile, mkdir, readdir, stat, unlink } from 'fs/promises'
import path from 'path'
import { dataDir } from '../utils/dirs'

const AGY_BIN = path.join(homedir(), '.local/bin/agy')
export const AGY_PROBE_MODEL = 'gemini-3.8-flash-low'
/**
 * 探测专用数据目录：只保留官方 CLI 的最小状态（登录走钥匙串，不受目录影响）。
 * 不能复用 ~/.gemini/antigravity-cli —— 那里会加载用户的 skills / MCP / 全局规则，
 * 单次 print 的 input 从 6.9k 膨胀到 34k（实测）。
 */
const AGY_PROBE_DIR = path.join(dataDir(), 'agy-probe')
/** 探测会话只用于进程内的一次性请求；保留 24h 便于排查，之后清掉，避免每天 ~22MB 的 DB 累积。 */
const AGY_PROBE_CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000

/** 一次 agy CLI 探测的原始结果：拿到响应（已归类成 HTTP 状态）、CLI 起不来，或超时被杀。 */
export type NativeAgyResponse =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'unreachable' }
  | { kind: 'timeout' }

/**
 * 清理探测目录里的历史会话：探测是一次性请求，保留 24h 足够排查；
 * 不清理的话每次 print 都会新建一个 ~448KB 的 SQLite（每天约 22MB）。
 */
async function pruneAgyProbeConversations(cliDir: string): Promise<void> {
  const conversationsDir = path.join(cliDir, 'conversations')
  let entries: string[]
  try {
    entries = await readdir(conversationsDir)
  } catch {
    return
  }
  const cutoff = Date.now() - AGY_PROBE_CONVERSATION_TTL_MS
  await Promise.all(
    entries
      .filter((name) => /\.db(?:-(?:wal|shm))?$/.test(name))
      .map(async (name) => {
        const filePath = path.join(conversationsDir, name)
        try {
          const info = await stat(filePath)
          if (info.mtimeMs < cutoff) {
            await unlink(filePath)
          }
        } catch {
          // 清理是 best-effort，失败不影响探测。
        }
      })
  )
}

/** 探测目录只初始化一次；失败也继续 spawn，由 agy 自行创建目录。 */
let agyProbeDirReady: Promise<void> | null = null

function ensureAgyProbeDir(): Promise<void> {
  if (agyProbeDirReady) {
    return agyProbeDirReady
  }
  agyProbeDirReady = (async () => {
    const cliDir = path.join(AGY_PROBE_DIR, 'antigravity-cli')
    await mkdir(cliDir, { recursive: true })
    // 复用主目录的 installation_id：同一台机器不应因为探测目录多出一个“新设备”。
    try {
      await copyFile(
        path.join(homedir(), '.gemini/antigravity-cli/installation_id'),
        path.join(cliDir, 'installation_id'),
        constants.COPYFILE_EXCL
      )
    } catch {
      // 已存在或主目录没有该文件：保持现状即可。
    }
    await pruneAgyProbeConversations(cliDir)
  })().catch(() => undefined)
  return agyProbeDirReady
}

export async function requestNativeAgy(timeoutMs: number): Promise<NativeAgyResponse> {
  await ensureAgyProbeDir()
  return new Promise((resolve) => {
    const printTimeoutSec = Math.max(15, Math.floor(timeoutMs / 1000) - 5)
    const env = { ...process.env }
    delete env.GEMINI_API_KEY
    delete env.GOOGLE_GEMINI_BASE_URL
    delete env.GOOGLE_API_KEY
    delete env.CLOUD_CODE_URL
    let child
    try {
      child = spawn(
        AGY_BIN,
        [
          '--gemini_dir',
          AGY_PROBE_DIR,
          '--print',
          'Reply with exactly: OK',
          '--model',
          AGY_PROBE_MODEL,
          '--print-timeout',
          `${printTimeoutSec}s`,
          '--output-format',
          'text'
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch {
      resolve({ kind: 'unreachable' })
      return
    }

    let stdout = ''
    let stderr = ''

    // promise 只会兑现一次，先到的结局（退出 / 报错 / 超时）为准；兑现时一并清掉超时器。
    const finish = (value: NativeAgyResponse): void => {
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // 进程可能已经退出，忽略即可。
      }
      finish({ kind: 'timeout' })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 16384) {
        stdout += chunk.toString()
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 16384) {
        stderr += chunk.toString()
      }
    })
    child.on('error', () => finish({ kind: 'unreachable' }))
    child.on('close', (code) => {
      const body = `${stdout}\n${stderr}`
      if (/User location is not supported/i.test(body)) {
        finish({ kind: 'response', status: 400, body })
        return
      }
      if (code === 0) {
        finish({ kind: 'response', status: 200, body })
        return
      }
      if (/FAILED_PRECONDITION|PERMISSION_DENIED|not logged|sign in|authentication/i.test(body)) {
        finish({ kind: 'response', status: 403, body })
        return
      }
      finish({ kind: 'response', status: 500, body })
    })
  })
}
