// [INPUT] 已安装 App 的 build meta / CDHash / 内核权限状态 · 升级事务阶段与目录存在性 ·
//         升级锁 owner · 恢复轮次环境变量
// [OUTPUT] CORE_BINARY_NAMES · isCoreSetuidMode · resolveInstallShortCircuit ·
//          planInterruptedUpgradeRecovery · UPGRADE_MARKER_TTL_MINUTES ·
//          resolvePostInstallRecoveryRounds · parseLockOwner · isLockOwnerActive · formatLockOwner
// [POS] Agent 本地升级的幂等与安全判定纯函数：决定「是否需要真的安装/启停」、被打断的事务
// 如何恢复、失败后是否允许自动重启。这里是判定语义的 SSOT 与文档；shell 侧为了不依赖
// `tsx -e` 传参（参数会被 node 当成选项解析）而用等价的纯 bash 实现
// （lib/install-gate.sh、lib/install-transaction.sh），两者由 scripts 下的契约测试逐格对齐。

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
  /**
   * 已安装版本的内核权限要求已满足：不需要 setuid（TUN 关闭，或内核由 root 服务拉起），
   * 或需要且已具备。要求未满足是必须修的缺陷，不能短路。
   */
  corePermissionSatisfied: boolean
}

export interface InstallShortCircuitDecision {
  skip: boolean
  reason: string
}

/**
 * 短路判定：几件事同时成立时安装完全是空操作——同样的字节已经在 `/Applications` 里运行，
 * 再 quit + 换装 + 启动只会打断用户却不会改变任何东西。缺任一条都必须走真实安装，
 * 尤其 `corePermissionSatisfied`：权限缺失是必须修的缺陷，不能被「看起来已安装」掩盖。
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
  if (!input.corePermissionSatisfied) {
    return { skip: false, reason: 'core_setuid_missing' }
  }
  return { skip: true, reason: 'already_installed_and_healthy' }
}

/** 后台定时任务见到新鲜的静默标记就不碰 App；超过该分钟数视为安装进程已崩溃。 */
export const UPGRADE_MARKER_TTL_MINUTES = 15

export type UpgradePhase = 'none' | 'staging' | 'quiesced' | 'swapping' | 'swapped' | 'committed'

export interface InterruptedUpgradeState {
  phase: UpgradePhase
  /** 安装目标（/Applications/Sparkle.app）存在。 */
  destExists: boolean
  /** 旧包备份（.Sparkle.prev）存在。 */
  prevExists: boolean
  /** 新包暂存区（.Sparkle.staging）存在。 */
  stageExists: boolean
  /** 失败品目录（.Sparkle.failed）存在：回滚中途被打断时留下的、未经验证的新包。 */
  failedExists: boolean
}

export type RecoveryStep =
  | 'remove_stage'
  | 'remove_failed'
  | 'remove_prev'
  | 'restore_prev'
  | 'discard_dest_restore_prev'

/**
 * 被打断（崩溃、强杀、回滚）的升级事务如何收尾。决策只看「阶段 + 四个目录是否存在」：
 *  - 暂存区与失败品目录永远是草稿，直接删；
 *  - 换装已开始（swapping/swapped）且备份在：目标在说明新包已就位但没被验证，丢弃并放回旧包；
 *    目标不在说明正卡在两次 rename 之间，直接放回旧包；
 *  - 其它阶段备份还在：目标在说明是上次提交后的清理被打断，删备份；目标不在则放回备份；
 *  - 备份不在就没有可回退的旧包，保留目标现状。
 * 任何输入下，处理完目标要么是旧包、要么是已验证的新包，不会既删旧又没新。
 */
export function planInterruptedUpgradeRecovery(state: InterruptedUpgradeState): RecoveryStep[] {
  const steps: RecoveryStep[] = []
  if (state.stageExists) {
    steps.push('remove_stage')
  }
  if (state.failedExists) {
    steps.push('remove_failed')
  }
  if (!state.prevExists) {
    return steps
  }
  const swapStarted = state.phase === 'swapping' || state.phase === 'swapped'
  if (swapStarted) {
    steps.push(state.destExists ? 'discard_dest_restore_prev' : 'restore_prev')
  } else {
    steps.push(state.destExists ? 'remove_prev' : 'restore_prev')
  }
  return steps
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
