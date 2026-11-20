// [INPUT] docDriftCore::checkDocDrift/formatDriftReport (POS: 文档漂移守护的入口，一次判完文件头、_ARCH.md、ARCHITECTURE.md 与代码是否一致) ·
//         docDriftRepo::loadRepoSnapshot (POS: 文档漂移守护的磁盘装载层，守护里唯一碰文件系统的一环) · node:path
// [OUTPUT] （无导出，仅命令行入口）：文档与代码一致就打印一行结论并以 0 退出；有漂移就把报告打到 stderr、以 1 退出
// [POS] 文档守护的命令行入口：`pnpm run check:docs` 与 `agent-sparkle-upgrade.sh` 装包前的第一道门禁共用它。
//       只对脚本所在的这份工作树做一次对账，不跑守护自己的测试，所以输出里只有漂移本身；
//       装载失败（没有根 `ARCHITECTURE.md`、没有 `package.json`）抛错退出，同样是非零，不会被当成通过。
import path from 'node:path'
import { checkDocDrift, formatDriftReport } from './docDriftCore'
import { loadRepoSnapshot } from './docDriftRepo'

const snapshot = loadRepoSnapshot(path.resolve(import.meta.dirname, '../..'))
const findings = checkDocDrift(snapshot)

if (findings.length === 0) {
  console.log(
    `文档与代码一致（核对了 ${snapshot.docs.size} 份文档、${snapshot.sources.size} 个源码文件）`
  )
} else {
  console.error(formatDriftReport(findings))
  process.exitCode = 1
}
