// [INPUT] provider 叶子节点 history
// [OUTPUT] mapWithConcurrency · listUnconfirmedLeafNames
// [POS] 低并发逐点拨测的纯逻辑：冷启动时用它代替「整个 provider 同时体检」，避免批量并发把正常节点测成超时。

import { judgeProxyDelay } from './proxyDelayVerdictCore'

export interface ProviderLeaf {
  name: string
  history?: ControllerProxiesHistory[]
}

/** 至多 `concurrency` 个任务同时进行，其余排队；单个任务抛错不影响其余任务。 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      try {
        await run(item)
      } catch {
        // 单点失败已由 mihomo 记入 history；其余节点继续
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

/** 仍是「超时」或「未测」的节点：它们的结论尚未经过一次低并发的复测确认。 */
export function listUnconfirmedLeafNames(leaves: readonly ProviderLeaf[], nowMs?: number): string[] {
  return leaves
    .filter((leaf) => {
      const kind = judgeProxyDelay(leaf.history, nowMs).kind
      return kind === 'failed' || kind === 'untested'
    })
    .map((leaf) => leaf.name)
}
