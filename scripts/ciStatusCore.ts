// [INPUT] 全局 AbortSignal（给网络请求限时）· 调用方注入的 git 与 fetch（本模块自己不碰进程、文件系统与网络）
// [OUTPUT] CI_WORKFLOW_FILE: 被读取状态的工作流文件名 · CI_STATUS_TIMEOUT_MS: 一次请求的时限 ·
//          CiStatusDeps · FetchTextResult · parseGithubSlug · parseBadgeState · createFetchText · checkCiStatus
// [POS] 「远程分支的 CI 现在是红是绿」提示的全部判断：从当前分支的 upstream 找到 GitHub 仓库，读它的工作流状态徽章，
//       翻译成一行日志。git 与网络由调用方注入，没有 upstream、不是 GitHub 远程、取不到、响应读不懂这些分支都能不联网地测；
//       每一种失败都只产出一行「跳过」，不抛异常——这是只读的提示，不是门禁。
const GITHUB_REMOTE =
  /^(?:(?:[^@/\s]+@)?github\.com:|(?:ssh|https?|git):\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/
const BADGE_TITLE = /<title>([^<]*)<\/title>/
const BADGE_STATE = /^[a-z][a-z ]{0,19}$/
const ONLY_DOTS = /^\.+$/

/** `build.yml` 是唯一在 push 到主分支时跑的 CI 工作流；改名后徽章 404，提示会说「取不到」，测试同时核对这个文件名。 */
export const CI_WORKFLOW_FILE = 'build.yml'

/** 实测一次徽章请求经代理约 1–4 秒；留出余量，又不让离线或被黑洞的网络把装包路径拖得太久。 */
export const CI_STATUS_TIMEOUT_MS = 6000

export type FetchTextResult = { ok: true; text: string } | { ok: false; reason: string }

export interface CiStatusDeps {
  /** 运行 git 并返回去掉首尾空白的标准输出；命令失败、没有 git 或输出为空时返回 undefined。 */
  git: (args: readonly string[]) => string | undefined
  /** GET 一段文本；非 2xx、网络失败、超时都以 `{ ok: false, reason }` 返回，不抛异常。 */
  fetchText: (url: string) => Promise<FetchTextResult>
  /** 状态徽章所在站点的根地址，不带结尾的斜杠。 */
  baseUrl: string
}

/** 从 git 远程地址取出 `owner/repo`；不是 github.com 的地址返回 undefined。凭据只会出现在被丢弃的部分里。 */
export function parseGithubSlug(remoteUrl: string): string | undefined {
  const match = GITHUB_REMOTE.exec(remoteUrl.trim())
  if (match === null) return undefined
  const [, owner, repo] = match
  if (owner === undefined || repo === undefined) return undefined
  // `..` 之类的名字拼进路径会被规范化成别的仓库。
  return ONLY_DOTS.test(owner) || ONLY_DOTS.test(repo) ? undefined : `${owner}/${repo}`
}

/**
 * 读状态徽章 SVG 的标题 `<工作流名> - <状态>`（如 `Build - passing`），返回状态。
 * 状态只收小写字母与空格：响应来自网络，进日志的字符必须是可控的。
 */
export function parseBadgeState(svg: string): string | undefined {
  const title = BADGE_TITLE.exec(svg)?.[1]
  if (title === undefined) return undefined
  const separator = title.lastIndexOf(' - ')
  if (separator < 0) return undefined
  const state = title
    .slice(separator + 3)
    .trim()
    .toLowerCase()
  return BADGE_STATE.test(state) ? state : undefined
}

export function createFetchText(
  fetchImpl: typeof fetch,
  timeoutMs: number
): CiStatusDeps['fetchText'] {
  return async (url) => {
    try {
      // 限时覆盖连接、响应头与读完响应体，不会卡在只发了一半的响应上。
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
      return { ok: true, text: await response.text() }
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      return {
        ok: false,
        reason: timedOut ? `no answer within ${timeoutMs / 1000}s` : 'network error'
      }
    }
  }
}

function skipped(why: string): string {
  return `CI status: ${why} — skipped`
}

function describeState(upstream: string, state: string, runsUrl: string): string {
  if (state === 'passing') return `CI status: ${upstream} — passing`
  if (state === 'failing') {
    return `WARN ci status: ${upstream} — failing; GitHub reports the workflow as red on that branch, read the failing run before trusting what it built (${runsUrl})`
  }
  return `CI status: ${upstream} — ${state}`
}

async function probe(deps: CiStatusDeps): Promise<string> {
  const upstream = deps.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  const slash = upstream?.indexOf('/') ?? -1
  if (upstream === undefined || slash <= 0) return skipped('no upstream branch on a remote')
  const remote = upstream.slice(0, slash)
  const branch = encodeURIComponent(upstream.slice(slash + 1))

  const remoteUrl = deps.git(['remote', 'get-url', remote])
  const slug = remoteUrl === undefined ? undefined : parseGithubSlug(remoteUrl)
  if (slug === undefined) return skipped(`${remote} is not a GitHub remote`)

  const badge = await deps.fetchText(
    `${deps.baseUrl}/${slug}/actions/workflows/${CI_WORKFLOW_FILE}/badge.svg?branch=${branch}`
  )
  if (!badge.ok) return skipped(`unavailable (${badge.reason})`)
  const state = parseBadgeState(badge.text)
  if (state === undefined) return skipped('unavailable (unexpected response)')
  return describeState(upstream, state, `${deps.baseUrl}/${slug}/actions?query=branch%3A${branch}`)
}

/** 当前分支所跟踪的远程分支的 CI 结论，一行文字。无论哪里出错都返回一行「跳过」，从不抛异常。 */
export async function checkCiStatus(deps: CiStatusDeps): Promise<string> {
  try {
    return await probe(deps)
  } catch {
    return skipped('unavailable (unexpected error)')
  }
}
