// [INPUT] node:fs · node:os（只用系统临时目录）
// [OUTPUT] makeTempDir: 创建临时目录，进程退出时自动删除
// [POS] 脚本测试共用的临时目录：清理由进程退出统一兜底，测试文件不需要（也不可能忘记）自己清理。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const tempDirs: string[] = []

// 退出事件覆盖正常结束、`process.exit` 与未捕获异常；`rmSync` 是同步的，可以在退出事件里完成。
process.once('exit', () => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
