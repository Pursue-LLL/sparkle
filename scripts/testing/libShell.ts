// [INPUT] scripts/lib/install-transaction.sh (POS: 升级事务库，连带 source 门禁与 App 控制库)
// [OUTPUT] LibShell · libShell: 在只读的真实 PATH 下 source 事务库并执行一段脚本，返回 stdout
// [POS] 事务库的函数级测试夹具：库 source 时没有副作用，可以对单个函数做确定性的输入输出测试。
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const SCRIPTS = join(import.meta.dirname, '..')

export type LibShell = (script: string, env?: Record<string, string>) => string

/**
 * 在只读的真实 PATH 下 source 事务库（含门禁与 App 控制库）并执行一段脚本，返回 stdout。
 * 库 source 时没有副作用，所以可以直接对单个函数做确定性的输入输出测试；
 * 需要模拟系统命令时，在脚本里先定义同名 shell 函数即可（函数优先于 PATH 里的命令）。
 */
export function libShell(scratch: string): LibShell {
  return (script, env = {}) =>
    execFileSync(
      '/bin/bash',
      [
        '-c',
        `set -uo pipefail\nDEST="${scratch}/Sparkle.app"\nROOT="${SCRIPTS}/.."\nsource "${SCRIPTS}/lib/install-transaction.sh"\n${script}`
      ],
      {
        env: {
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          HOME: scratch,
          SPARKLE_STATE_DIR: join(scratch, 'state'),
          ...env
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
}
