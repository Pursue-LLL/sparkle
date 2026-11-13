// [INPUT] sparkleMainAsarSourceCore::collectSparkleMainProcessAsarSource (POS: 主进程 bundle 文本收集)
// [OUTPUT] BakedBuildStamp · parseBakedBuildStamp · readBakedBuildStampFromAsar: 读出构建时烧进二进制的 git 事实
// [POS] 防漂移的 app 侧事实读取层。按内容定位 `SPARKLE_GIT_COMMIT` 声明，不依赖打包器给它起的 chunk 文件名：
//       buildStamp 可能被拆成独立 chunk，也可能内联进 index.js，两种产物都必须读得出来。

import { collectSparkleMainProcessAsarSource } from './sparkleMainAsarSourceCore'

export interface BakedBuildStamp {
  commit: string
  dirty: boolean
}

const COMMIT_DECLARATION_RE = /SPARKLE_GIT_COMMIT\s*=\s*["']([^"']*)["']/
/** 压缩器会把 `true` 写成 `!0`；漏判会把脏构建报成干净。 */
const DIRTY_DECLARATION_RE = /SPARKLE_GIT_DIRTY\s*=\s*(?:true|!0)\b/

/** 从主进程 bundle 文本里读出构建标记；没有 commit 声明（或为空）时返回 undefined。 */
export function parseBakedBuildStamp(bundleSource: string): BakedBuildStamp | undefined {
  const commit = COMMIT_DECLARATION_RE.exec(bundleSource)?.[1]
  if (!commit) {
    return undefined
  }
  return { commit, dirty: DIRTY_DECLARATION_RE.test(bundleSource) }
}

/** 读取已安装 app.asar 里烧进去的构建标记；asar 里没有 `out/main/*.js` 时抛错。 */
export function readBakedBuildStampFromAsar(appAsarPath: string): BakedBuildStamp | undefined {
  return parseBakedBuildStamp(collectSparkleMainProcessAsarSource(appAsarPath))
}
