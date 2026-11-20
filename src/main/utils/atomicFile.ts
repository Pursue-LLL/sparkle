// [INPUT] Node 内置 fs/promises（writeFile / rename）· 目标文件路径与完整文本内容
// [OUTPUT] writeFileAtomic: 原子写文本文件，同一路径的写入排队串行
// [POS] 持久化状态的落盘原语：先写同目录临时文件再 rename 覆盖，读者要么看到旧内容要么看到新内容，
//       进程中途退出不会留下写了一半的 JSON；同一路径的写入排成一队，重叠写入不会互相覆盖临时文件。

import { rename, writeFile } from 'fs/promises'

/** 每个路径一条写入队列；队尾吞掉失败，保证某一次写失败不会连累排在后面的写入。 */
const writeTails = new Map<string, Promise<void>>()

/** 失败只通过返回的 promise 交给本次调用方，是否容忍由调用方决定。 */
export function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const previous = writeTails.get(filePath) ?? Promise.resolve()
  const current = previous.then(async () => {
    const tmpPath = `${filePath}.tmp`
    await writeFile(tmpPath, content, 'utf8')
    await rename(tmpPath, filePath)
  })
  writeTails.set(
    filePath,
    current.catch(() => undefined)
  )
  return current
}
