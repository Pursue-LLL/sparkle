// [INPUT] 官方 agy CLI（~/.local/bin/agy，keychain 登录）· 探测专用干净目录 · 调用方给的出口代理地址 ·
//         sparkleAgyProviderCore::AGY_LOCATION_REJECTION (POS: agy provider 与分组配置) ·
//         utils/dirs::dataDir (POS: 应用目录与路径常量)
// [OUTPUT] AGY_PROBE_MODEL · AGY_PROBE_DIR · requestNativeAgy · NativeAgyResponse
// [POS] 跑一次官方 agy CLI 的真实请求，把这次运行归类成 HTTP 状态：地区被拒 → 400，退出码 0 → 200，登录问题 → 403，其余 → 500。
// 地区被拒有两处证据：生成请求的 400 在 CLI 输出里；aicode 的 403 `LOCATION_NOT_ELIGIBLE` 只写进 CLI 日志，
// 此时生成请求常常仍返回 200，所以每次运行都指定独立的日志文件并读取它。
// 干净目录不加载用户的 skills / MCP / 全局规则（34k → 6.9k input），同时保留官方客户端的全部请求特征。
// 出口由调用方用环境变量代理指定：探测进程的全部连接经这个代理出站，不碰用户正在使用的 TUN 路由。

import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { copyFile, mkdir, readdir, readFile, stat, unlink } from 'fs/promises'
import path from 'path'
import { dataDir } from '../utils/dirs'
import { AGY_LOCATION_REJECTION } from './sparkleAgyProviderCore'

const AGY_BIN = path.join(homedir(), '.local/bin/agy')
export const AGY_PROBE_MODEL = 'gemini-3.8-flash-low'
/**
 * 探测专用数据目录：只保留官方 CLI 的最小状态（登录走钥匙串，不受目录影响）。
 * 不能复用 ~/.gemini/antigravity-cli —— 那里会加载用户的 skills / MCP / 全局规则，
 * 单次 print 的 input 从 6.9k 膨胀到 34k（实测）。
 */
export const AGY_PROBE_DIR = path.join(dataDir(), 'agy-probe')
const AGY_PROBE_CLI_DIR = path.join(AGY_PROBE_DIR, 'antigravity-cli')
const AGY_PROBE_LOG_SUBDIR = 'log'
/**
 * 探测产物只用于事后排查，保留 24h 后清掉：
 * 一次性会话的 SQLite 每次约 448KB（每天约 22MB），每次运行的 CLI 日志约 25KB。
 */
const AGY_PROBE_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000
const AGY_PROBE_ARTIFACTS = [
  { dir: 'conversations', pattern: /\.db(?:-(?:wal|shm))?$/ },
  { dir: AGY_PROBE_LOG_SUBDIR, pattern: /\.log$/ }
] as const
/** 判定依据截取命中处前后各多少字符：既要让命中的文案留在里面，又不把整份日志带出去。 */
const EVIDENCE_CONTEXT_CHARS = 120
/** 输出里的登录 / 权限问题：与出口无关，不能怪到节点头上。 */
const AUTH_PROBLEM = /FAILED_PRECONDITION|PERMISSION_DENIED|not logged|sign in|authentication/i

/** 一次 agy CLI 探测的原始结果：拿到响应（已归类成 HTTP 状态）、CLI 起不来，或超时被杀。 */
export type NativeAgyResponse =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'unreachable' }
  | { kind: 'timeout' }

/** 清掉目录里超过保留期、且名字符合 `pattern` 的文件；目录不存在或单个文件删不掉都不影响探测。 */
async function pruneStaleFiles(dir: string, pattern: RegExp): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  const cutoff = Date.now() - AGY_PROBE_ARTIFACT_TTL_MS
  await Promise.all(
    entries
      .filter((name) => pattern.test(name))
      .map(async (name) => {
        const filePath = path.join(dir, name)
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
    await mkdir(AGY_PROBE_CLI_DIR, { recursive: true })
    // 复用主目录的 installation_id：同一台机器不应因为探测目录多出一个“新设备”。
    try {
      await copyFile(
        path.join(homedir(), '.gemini/antigravity-cli/installation_id'),
        path.join(AGY_PROBE_CLI_DIR, 'installation_id'),
        constants.COPYFILE_EXCL
      )
    } catch {
      // 已存在或主目录没有该文件：保持现状即可。
    }
    await Promise.all(
      AGY_PROBE_ARTIFACTS.map(({ dir, pattern }) =>
        pruneStaleFiles(path.join(AGY_PROBE_CLI_DIR, dir), pattern)
      )
    )
  })().catch(() => undefined)
  return agyProbeDirReady
}

let probeLogSequence = 0

/** 每次运行独占一个日志文件：默认的日志按启动时间（秒）命名，并发运行会撞名，读取时也无法确定哪一份属于这次运行。 */
function nextProbeLogFile(): string {
  probeLogSequence += 1
  return path.join(
    AGY_PROBE_CLI_DIR,
    AGY_PROBE_LOG_SUBDIR,
    `probe-${Date.now()}-${probeLogSequence}.log`
  )
}

/** 本次运行的 CLI 日志；读不到（CLI 没写出来、文件不可读）就当没有证据，不因此给节点定性。 */
async function readProbeLog(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return ''
  }
}

/** 命中地区拒绝文案时返回命中处前后的一小段原文，作为判定依据；没命中返回 undefined。 */
function locationRejectionEvidence(text: string): string | undefined {
  const hit = AGY_LOCATION_REJECTION.exec(text)
  if (!hit) {
    return undefined
  }
  return text.slice(
    Math.max(0, hit.index - EVIDENCE_CONTEXT_CHARS),
    hit.index + hit[0].length + EVIDENCE_CONTEXT_CHARS
  )
}

interface CliRun {
  code: number | null
  /** stdout + stderr。 */
  output: string
  /** 本次运行的 CLI 日志；读不到时为空串。 */
  log: string
}

/** 一次运行归类成 HTTP 状态；地区被拒先于退出码判断，因为 aicode 拒绝的出口上生成请求常常仍然成功。 */
function classifyCliRun({ code, output, log }: CliRun): { status: number; body: string } {
  const rejection = locationRejectionEvidence(output) ?? locationRejectionEvidence(log)
  if (rejection !== undefined) {
    return { status: 400, body: rejection }
  }
  if (code === 0) {
    return { status: 200, body: output }
  }
  return { status: AUTH_PROBLEM.test(output) ? 403 : 500, body: output }
}

/** 会改变请求目标或绕过出口代理的环境变量：探测必须只经指定出口、只打官方端点。 */
const BYPASS_ENV_NAMES = [
  'GEMINI_API_KEY',
  'GOOGLE_GEMINI_BASE_URL',
  'GOOGLE_API_KEY',
  'CLOUD_CODE_URL',
  'NO_PROXY',
  'no_proxy'
] as const

/** 只给探测进程用的环境：全部出站走 `proxyUrl`，用户 shell 里的 NO_PROXY 之类不能让某些连接绕开它。 */
function buildProbeEnv(proxyUrl: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const name of BYPASS_ENV_NAMES) {
    delete env[name]
  }
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) {
    env[name] = proxyUrl
  }
  return env
}

export async function requestNativeAgy(
  timeoutMs: number,
  proxyUrl: string
): Promise<NativeAgyResponse> {
  await ensureAgyProbeDir()
  return new Promise((resolve) => {
    const printTimeoutSec = Math.max(15, Math.floor(timeoutMs / 1000) - 5)
    const logFile = nextProbeLogFile()
    const env = buildProbeEnv(proxyUrl)
    let child
    try {
      child = spawn(
        AGY_BIN,
        [
          '--gemini_dir',
          AGY_PROBE_DIR,
          '--log-file',
          logFile,
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
      void readProbeLog(logFile).then((log) => {
        finish({
          kind: 'response',
          ...classifyCliRun({ code, output: `${stdout}\n${stderr}`, log })
        })
      })
    })
  })
}
