// [INPUT] node:test mock.module · node:fs 同步读写
// [OUTPUT] mockFsPromisesSync
// [POS] 行为测试共用：把 `fs/promises` 的 readFile/writeFile 换成同步实现。
// 周期任务与「发出去就不管」的后台任务没有 promise 可等，同步实现让它们的每一步都在微任务里完成，
// 推进时钟后让出一轮事件循环即可确定任务已结束。仅供测试使用。

import { readFileSync, writeFileSync } from 'node:fs'
import { mock } from 'node:test'

/** node:test 对同一个模块只允许替换一次，调用方要保证每个测试进程只调用一次。 */
export function mockFsPromisesSync(): void {
  mock.module('fs/promises', {
    exports: {
      readFile: async (file: string, encoding: BufferEncoding): Promise<string> =>
        readFileSync(file, encoding),
      writeFile: async (file: string, data: string, encoding: BufferEncoding): Promise<void> =>
        writeFileSync(file, data, encoding)
    }
  })
}
