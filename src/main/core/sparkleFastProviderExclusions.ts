// [INPUT] sparkleGeminiProbe::loadGeminiBlockedNodeNames (POS: Gemini 地区探测与缓存) ·
//         sparkleNodeQualityCache::loadSunkNodeNames (POS: 吞吐判劣节点的沉底记录) ·
//         sparkleFastProviderCore::FastProviderExclusions (POS: sparkle-fast provider 文件生成) ·
//         sparkleMailProviderCore::MailProxyRecord (POS: 邮件 provider 与分组配置)
// [OUTPUT] loadFastProviderExclusions
// [POS] 写 `sparkle-fast` 文件时「哪些节点剔除、哪些节点沉底」的唯一加载入口。
// 配置生成、Gemini 审计重建、延迟重排三处都读它，写出的顺序才一致；任何一处漏读，沉底节点就会在下一次重写时又排回最前。

import type { FastProviderExclusions } from './sparkleFastProviderCore'
import type { MailProxyRecord } from './sparkleMailProviderCore'
import { loadSunkNodeNames } from './sparkleNodeQualityCache'

export async function loadFastProviderExclusions(
  proxies: readonly MailProxyRecord[]
): Promise<FastProviderExclusions> {
  // 调用时才引入：Gemini 审计重建本身也会调用本函数，静态互相引用会成环。
  const { loadGeminiBlockedNodeNames } = await import('./sparkleGeminiProbe')
  const [blockedNodeNames, sunkNodeNames] = await Promise.all([
    loadGeminiBlockedNodeNames(proxies),
    loadSunkNodeNames()
  ])
  return { blockedNodeNames, sunkNodeNames }
}
