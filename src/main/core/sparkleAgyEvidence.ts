// [INPUT] agy 默认日志目录（~/.gemini/antigravity-cli/log）· 运行中的 agy 进程用 `--log-file` 指定的日志（pgrep）·
//         sparkleAgyCli::AGY_PROBE_DIR (POS: 官方 agy CLI 请求) ·
//         sparkleAgyEvidenceCore::AGY_EVIDENCE_*/extractAgyRejections/parseAgyLogFilePaths (POS: agy 出口生产证据)
// [OUTPUT] collectAgyProductionEvidence · AgyProductionEvidence
// [POS] 读取用户真实 agy 会话的日志，汇总最近的地区拒绝记录与会话活跃时间。
// 会话日志有两处：默认目录，以及启动器用 `--log-file` 指定的位置（只能从进程列表里发现）。
// 探针自己的日志不是生产证据，必须排除。只读尾部：日志会被长会话持续写到几 MB，窗口只有 10 分钟。
// 任何一步读不到都当没有证据，绝不外抛：证据环是增强，不能因为它出错拖垮巡检。

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { open, readdir, readFile, stat } from 'fs/promises'
import path from 'path'
import { AGY_PROBE_DIR } from './sparkleAgyCli'
import {
  AGY_EVIDENCE_ACTIVITY_MS,
  AGY_EVIDENCE_WINDOW_MS,
  extractAgyRejections,
  parseAgyLogFilePaths,
  type AgyRejections
} from './sparkleAgyEvidenceCore'

const DEFAULT_LOG_DIR = path.join(homedir(), '.gemini', 'antigravity-cli', 'log')
/** 窗口外的记录不参与判定；文件的修改时间不早于其中任何一条记录，所以更旧的文件整个不用读。 */
const FRESH_FILE_MS = Math.max(AGY_EVIDENCE_WINDOW_MS, AGY_EVIDENCE_ACTIVITY_MS)
/** 同时开着的 agy 会话数远小于此；封顶只是防止异常目录拖慢每轮读取。 */
const MAX_LOG_FILES = 16
/** 一份日志只读最后这么多字节：活跃会话每分钟写几十 KB，足够覆盖整个窗口。 */
const TAIL_BYTES = 512 * 1024
/**
 * 只列出 agy 进程的命令行，不枚举全部进程：每分钟一次，`ps -axww` 要 96ms CPU，`pgrep` 只要 14ms（实测）。
 * 完整命令行的选项在 macOS 是 `-l`，在 Linux 是 `-a`；没有 pgrep（Windows）就当没有发现。
 */
const PROCESS_LISTING = {
  command: 'pgrep',
  args: ['-f', process.platform === 'darwin' ? '-l' : '-a', '--', '(^|/)agy ']
} as const
const PROCESS_LISTING_TIMEOUT_MS = 3000
/** 匹配到的 agy 进程不过几个，输出远小于此；超出说明环境异常，放弃发现比截断后误读更安全。 */
const PROCESS_LISTING_MAX_BUFFER_BYTES = 1024 * 1024

export interface AgyProductionEvidence {
  rejections: AgyRejections
  /** 最近一次有 agy 会话写日志的时间；没有活跃会话为 null。 */
  lastActivityMs: number | null
}

const noEvidence = (): AgyProductionEvidence => ({
  rejections: { generation: [], aicode: [] },
  lastActivityMs: null
})

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function listDefaultLogFiles(): Promise<string[]> {
  try {
    return (await readdir(DEFAULT_LOG_DIR))
      .filter((name) => name.endsWith('.log'))
      .map((name) => path.join(DEFAULT_LOG_DIR, name))
  } catch {
    return []
  }
}

/** 运行中的 agy 进程指定的日志；pgrep 不可用、没有匹配的进程（退出码 1）或超时都当作没有。 */
function listProcessLogFiles(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      PROCESS_LISTING.command,
      PROCESS_LISTING.args,
      { timeout: PROCESS_LISTING_TIMEOUT_MS, maxBuffer: PROCESS_LISTING_MAX_BUFFER_BYTES },
      (error, stdout) => resolve(error ? [] : parseAgyLogFilePaths(stdout))
    )
  })
}

interface LogFile {
  file: string
  size: number
  mtimeMs: number
}

async function statFresh(file: string, nowMs: number): Promise<LogFile | undefined> {
  try {
    const info = await stat(file)
    return nowMs - info.mtimeMs <= FRESH_FILE_MS
      ? { file, size: info.size, mtimeMs: info.mtimeMs }
      : undefined
  } catch {
    return undefined
  }
}

async function readTail({ file, size }: LogFile): Promise<string> {
  if (size <= TAIL_BYTES) {
    return readFile(file, 'utf8')
  }
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(TAIL_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, TAIL_BYTES, size - TAIL_BYTES)
    // 截断点可能落在一条记录中间：没有行头的残段不会被计入（见 extractAgyRejections）。
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function readRejections(log: LogFile, nowMs: number): Promise<AgyRejections> {
  try {
    return extractAgyRejections(await readTail(log), nowMs)
  } catch {
    return { generation: [], aicode: [] }
  }
}

export async function collectAgyProductionEvidence(nowMs: number): Promise<AgyProductionEvidence> {
  try {
    const [defaults, fromProcesses] = await Promise.all([
      listDefaultLogFiles(),
      listProcessLogFiles()
    ])
    const candidates = new Set(
      [...defaults, ...fromProcesses].filter(
        (file) => path.isAbsolute(file) && !isInside(AGY_PROBE_DIR, file)
      )
    )
    const fresh = (await Promise.all([...candidates].map((file) => statFresh(file, nowMs))))
      .filter((log): log is LogFile => log !== undefined)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_LOG_FILES)
    if (fresh.length === 0) {
      return noEvidence()
    }

    const rejections: AgyRejections = { generation: [], aicode: [] }
    for (const part of await Promise.all(fresh.map((log) => readRejections(log, nowMs)))) {
      rejections.generation.push(...part.generation)
      rejections.aicode.push(...part.aicode)
    }
    return { rejections, lastActivityMs: fresh[0].mtimeMs }
  } catch {
    return noEvidence()
  }
}
