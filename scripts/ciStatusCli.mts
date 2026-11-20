// [INPUT] ciStatusCore::checkCiStatus/createFetchText/CI_STATUS_TIMEOUT_MS (POS: 远程 CI 状态提示的全部判断，git 与网络由调用方注入) ·
//         node:child_process · 本机 git（只读：rev-parse 与 remote get-url）· SPARKLE_CI_STATUS_BASE_URL
// [OUTPUT] （无导出，仅命令行入口）：在 stdout 打印一行以 `CI status:` 或 `WARN ci status:` 开头的结论，永远以 0 退出
// [POS] 远程分支 CI 状态提示的命令行入口：`pnpm run check:ci` 与 `agent-sparkle-upgrade.sh` 共用。
//       它是构建与安装开始之前唯一联网的一步（对 GitHub 的状态徽章发一次 GET，限时见 ciStatusCore），只提示不拦截：
//       取不到、读不懂、没有 upstream 都只说「跳过」，退出码不随结论变化。
//       SPARKLE_CI_STATUS_BASE_URL 换掉徽章所在站点（测试指向本机的假服务，也可指向镜像）。
import { execFileSync } from 'node:child_process'
import { checkCiStatus, CI_STATUS_TIMEOUT_MS, createFetchText } from './ciStatusCore'

const DEFAULT_BASE_URL = 'https://github.com'
const GIT_TIMEOUT_MS = 5000

/** 只读的 git 调用：失败、超时、没有 git 都当作「没有这个信息」。 */
function git(args: readonly string[]): string | undefined {
  try {
    const output = execFileSync('git', [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS
    }).trim()
    return output === '' ? undefined : output
  } catch {
    return undefined
  }
}

const baseUrl = (process.env.SPARKLE_CI_STATUS_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

console.log(
  await checkCiStatus({ git, fetchText: createFetchText(fetch, CI_STATUS_TIMEOUT_MS), baseUrl })
)
