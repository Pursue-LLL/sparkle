// [INPUT] mihomo `/connections` 快照 · 上一次组活动时间戳 · 当前时间 · 各组自己的观察窗口
// [OUTPUT] connectionChainsIncludeGroup · nextGroupActivityAtMs · isGroupRecentlyActive
// [POS] 专用组（邮件、gemini）按需探测共用的活动判定纯函数：只有组最近被用过才复测当前节点，观察窗口由各组自己给。

/** 活动连接链路中是否出现目标组名（mihomo `/connections` 的 `chains`）。 */
export function connectionChainsIncludeGroup(
  connections: ControllerConnections | undefined,
  groupName: string
): boolean {
  if (!connections?.connections?.length) {
    return false
  }
  return connections.connections.some(
    (connection) => connection.chains?.includes(groupName) ?? false
  )
}

/** 本轮看到活动连接就刷新时间戳；没看到则保留上一次活动时间。 */
export function nextGroupActivityAtMs(
  lastActiveAtMs: number,
  activeNow: boolean,
  nowMs: number
): number {
  return activeNow ? nowMs : lastActiveAtMs
}

/** 最近一次活动是否仍在观察窗口内；从未有过活动（时间戳为 0）一律算不活跃。 */
export function isGroupRecentlyActive(
  lastActiveAtMs: number,
  nowMs: number,
  windowMs: number
): boolean {
  return lastActiveAtMs > 0 && nowMs - lastActiveAtMs < windowMs
}
