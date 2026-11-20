// [INPUT] node:fs · node:path（只读检查 extra/sidecar 下的内核文件）
// [OUTPUT] assertSidecarPresent: 内核文件缺失、为空或不是文件时抛错并说明补救办法 · beforePack（默认导出）: electron-builder 的 beforePack 钩子
// [POS] 打包边界的内核校验：extraResources 把 extra/ 原样拷进安装包，缺了 mihomo 就会打出启动即内核失败的包。
import fs from 'node:fs'
import path from 'node:path'

/** electron-builder 传给 beforePack 的上下文里，本钩子读取的字段。 */
interface BeforePackContext {
  electronPlatformName: string
  packager: { projectDir: string }
}

/** 与 prepare.ts 写出内核时的文件名一致：Windows 带 `.exe`，其余平台不带。 */
function mihomoFileName(platform: string): string {
  return platform === 'win32' ? 'mihomo.exe' : 'mihomo'
}

/**
 * 校验放在打包前，而不是装依赖时：CI 先 `SKIP_PREPARE=1 pnpm install`，再由 `pnpm prepare` 下载内核，
 * 装依赖时内核本来就还不存在；真正需要它的是打包，所以由打包边界统一把关，不论从哪条路径进来。
 */
export function assertSidecarPresent(projectDir: string, platform: string): void {
  const relative = path.join('extra', 'sidecar', mihomoFileName(platform))
  // throwIfNoEntry: false 只放过「不存在」；权限等其它错误照常抛出，不被说成「缺失」。
  const stat = fs.statSync(path.join(projectDir, relative), { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.size === 0) {
    throw new Error(
      `${relative} is missing or empty, so the package would ship without the mihomo core. ` +
        'Run `node scripts/prepare.ts` (without SKIP_PREPARE) to download it, then pack again.'
    )
  }
}

export default async function beforePack(context: BeforePackContext): Promise<void> {
  // CI 红灯演练（临时，下一个提交会回退）：只让三个目标故意失败，其余目标照常跑完。
  const drillLabel = process.env.SPARKLE_CI_LABEL ?? ''
  if (
    ['ubuntu-latest-x64-deb', 'windows-latest-x64-7z', 'macos-latest-arm64'].includes(drillLabel)
  ) {
    throw new Error(`CI red drill: intentional failure for ${drillLabel}`)
  }
  assertSidecarPresent(context.packager.projectDir, context.electronPlatformName)
}
