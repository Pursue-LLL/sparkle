// [INPUT] 已安装 App 的 build meta / CDHash / setuid 状态 · 升级锁 owner · 恢复轮次环境变量
// [OUTPUT] CORE_BINARY_NAMES · isCoreSetuidMode · resolveInstallShortCircuit ·
//          shouldAttemptServiceKill · resolvePostInstallRecoveryRounds · formatLockOwner
// [POS] Agent 本地升级的幂等与安全判定纯函数：决定「是否需要真的安装/启停」、是否需要提权，
// 以及失败后是否允许自动重启。shell 只做 I/O 与提权执行，所有判断集中在这里，便于单测。

/** 需要 setuid 位的内核二进制；与 `permission.ts` 授权的目标一一对应。 */
export const CORE_BINARY_NAMES = ['mihomo', 'mihomo-alpha'] as const

export type CoreBinaryName = (typeof CORE_BINARY_NAMES)[number]

/** 权限位字符串（`stat -f '%Sp'`）中 owner 执行位为 `s` 或 `S` 即为 setuid。 */
export function isCoreSetuidMode(mode: string): boolean {
  const trimmed = mode.trim()
  // 形如 `-rwsr-sr-x` / `-rwSr-sr-x`；第 4 个字符是 owner 执行位。
  return trimmed.length >= 4 && (trimmed[3] === 's' || trimmed[3] === 'S')
}

export interface InstallShortCircuitInput {
  /** dist 的 build meta 与当前源码指纹一致（DistFreshness 通过）。 */
  distFresh: boolean
  /** dist 的 CDHash 与 `/Applications` 中已安装版本一致。 */
  cdhashMatches: boolean
  /** App GUI 进程正在运行。 */
  appRunning: boolean
  /** 本地代理端口可用（数据面在线）。 */
  dataPlaneReachable: boolean
  /** 已安装版本的内核 setuid 完整（缺了就必须修，不能短路）。 */
  coreSetuidIntact: boolean
}

export interface InstallShortCircuitDecision {
  skip: boolean
  reason: string
}

/**
 * 短路判定：四件事同时成立时安装完全是空操作——同样的字节已经在 `/Applications` 里运行，
 * 再 quit + ditto + 启动只会打断用户却不会改变任何东西。缺任一条都必须走真实安装，
 * 尤其 `coreSetuidIntact`：setuid 丢失是必须修的缺陷，不能被「看起来已安装」掩盖。
 */
export function resolveInstallShortCircuit(
  input: InstallShortCircuitInput
): InstallShortCircuitDecision {
  if (!input.distFresh) {
    return { skip: false, reason: 'dist_not_fresh' }
  }
  if (!input.cdhashMatches) {
    return { skip: false, reason: 'cdhash_mismatch' }
  }
  if (!input.appRunning) {
    return { skip: false, reason: 'app_not_running' }
  }
  if (!input.dataPlaneReachable) {
    return { skip: false, reason: 'data_plane_down' }
  }
  if (!input.coreSetuidIntact) {
    return { skip: false, reason: 'core_setuid_missing' }
  }
  return { skip: true, reason: 'already_installed_and_healthy' }
}

export interface ServiceKillInput {
  /** 当前用户能否直接向 service 进程发信号（同一用户或具备权限）。 */
  canSignalDirectly: boolean
  /** 非交互模式（CI / agent）：禁止弹出任何系统授权框。 */
  nonInteractive: boolean
}

export interface ServiceKillDecision {
  shouldKill: boolean
  /** 需要提权（会弹系统密码框）；一次升级最多只允许一次。 */
  needsElevation: boolean
  reason: string
}

/**
 * `sparkle-service` 以 root 运行时普通用户发不出信号。默认先直接尝试；
 * 只有直接尝试失败、且不是非交互模式时，才允许一次提权 killall。
 * 非交互模式绝不弹框：宁可跳过停服务（内核会由后续安装流程替换），也不打扰用户。
 */
export function shouldAttemptServiceKill(input: ServiceKillInput): ServiceKillDecision {
  if (input.canSignalDirectly) {
    return { shouldKill: true, needsElevation: false, reason: 'direct_signal' }
  }
  if (input.nonInteractive) {
    return { shouldKill: false, needsElevation: false, reason: 'skip_non_interactive' }
  }
  return { shouldKill: true, needsElevation: true, reason: 'elevated_signal' }
}

/**
 * 安装后自动恢复轮次。默认 0：失败就停下留现场，让调用方读日志定位根因，
 * 而不是自动重启 App 两次——每次重启都会因内核 setuid 缺失再要一次密码，
 * 用户感受到的「装完又退出、又要输密码」正是这样叠出来的。
 * 显式设置环境变量可临时放开（排查用），但不会成为默认行为。
 */
export function resolvePostInstallRecoveryRounds(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return 0
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }
  return Math.min(parsed, 3)
}

export interface LockOwner {
  pid: number
  startedAtMs: number
}

const LOCK_MAX_AGE_MS = 60 * 60 * 1000

/**
 * 解析锁文件内容；不存在或不合法返回 null（视为无锁）。
 * 只有「同主机 + pid + 开始时间」三者都合法时才算持锁，避免把残留空文件当成活锁永久卡死。
 */
export function parseLockOwner(text: string | undefined): LockOwner | null {
  if (!text) {
    return null
  }
  const pidMatch = /pid=(\d+)/.exec(text)
  const tsMatch = /started=(\d+)/.exec(text)
  if (!pidMatch || !tsMatch) {
    return null
  }
  const pid = Number.parseInt(pidMatch[1], 10)
  const startedAtMs = Number.parseInt(tsMatch[1], 10)
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return null
  }
  return { pid, startedAtMs }
}

/**
 * 现存锁是否仍然有效（持有者还活着且在合理时限内）。
 * `pidAlive` 由调用方注入（shell 用 `kill -0` 判定），保持本函数纯净。
 */
export function isLockOwnerActive(
  owner: LockOwner | null,
  pidAlive: boolean,
  nowMs: number
): boolean {
  if (!owner) {
    return false
  }
  if (!pidAlive) {
    return false
  }
  return nowMs - owner.startedAtMs < LOCK_MAX_AGE_MS
}

export function formatLockOwner(pid: number, startedAtMs: number): string {
  return `pid=${pid} started=${startedAtMs}\n`
}
