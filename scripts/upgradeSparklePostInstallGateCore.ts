// [INPUT] App 日志全文 · 安装时记下的日志行偏移（只评估安装之后写入的行）
// [OUTPUT] countPostCoreBootstrapFailuresSinceLine · hasMihomoApiReadySinceLine ·
//          hasMacOs26HeadlessBootstrapCompleteSinceLine · isMacOsProductVersion26OrNewer ·
//          POST_CORE_BOOTSTRAP_FAILED_RE · MIHOMO_API_READY_RE · MACOS26_HEADLESS_COMPLETE_RE
// [POS] 装包后门禁的纯判定：只看安装行偏移之后的 App 日志，内核引导是否失败、API 是否就绪、
// macOS 26 headless 引导是否完成；upgrade-sparkle-local.sh 的装后门控按它判定。

export const POST_CORE_BOOTSTRAP_FAILED_RE = /\[PostCoreBootstrap\]:.*failed/

export const MIHOMO_API_READY_RE = /\[PostCoreBootstrap\]: mihomo API ready/

export const MACOS26_HEADLESS_COMPLETE_RE = /\[MacOs26Headless\]: bootstrap complete/

function linesSinceExclusive(logText: string, sinceLineExclusive: number): string[] {
  if (sinceLineExclusive < 0) {
    return []
  }
  return logText.split('\n').slice(sinceLineExclusive)
}

export function countPostCoreBootstrapFailuresSinceLine(
  logText: string,
  sinceLineExclusive: number
): number {
  return linesSinceExclusive(logText, sinceLineExclusive).filter((line) =>
    POST_CORE_BOOTSTRAP_FAILED_RE.test(line)
  ).length
}

export function hasMihomoApiReadySinceLine(logText: string, sinceLineExclusive: number): boolean {
  return linesSinceExclusive(logText, sinceLineExclusive).some((line) =>
    MIHOMO_API_READY_RE.test(line)
  )
}

export function hasMacOs26HeadlessBootstrapCompleteSinceLine(
  logText: string,
  sinceLineExclusive: number
): boolean {
  return linesSinceExclusive(logText, sinceLineExclusive).some((line) =>
    MACOS26_HEADLESS_COMPLETE_RE.test(line)
  )
}

export function isMacOsProductVersion26OrNewer(productVersion: string): boolean {
  const head = productVersion.split('.')[0] ?? '0'
  const major = parseInt(head, 10)
  return Number.isFinite(major) && major >= 26
}
