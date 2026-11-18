import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

/**
 * manager.ts / sysproxy.ts 依赖 electron 与大量系统接口，无法在单测里真实执行，
 * 所以用文本守住接线：导出的入口必须经 timeSwitchOperation 计时，且名字与日志里的 op 一致。
 * patchControledMihomoConfig 的接线由 controledMihomoTiming.test.ts 真实执行验证。
 */

const ROOT = path.resolve(__dirname, '../../..')

const WIRED = [
  { file: 'src/main/core/manager.ts', exported: 'restartCore' },
  { file: 'src/main/sys/sysproxy.ts', exported: 'triggerSysProxy' }
] as const

describe('switch timing wiring', () => {
  for (const { file, exported } of WIRED) {
    it(`${file} times ${exported} through timeSwitchOperation`, () => {
      const source = readFileSync(path.join(ROOT, file), 'utf8')

      // 导出的是同步薄壳：返回 timeSwitchOperation(...) 的 Promise，真实逻辑在内部函数里。
      assert.match(source, new RegExp(`export function ${exported}\\(`))
      assert.match(source, new RegExp(`timeSwitchOperation\\('${exported}'`))
    })
  }
})
