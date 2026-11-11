// [INPUT] mihomo `/connections` 快照 · 上一次邮件活动时间戳 · 当前时间
// [OUTPUT] connectionChainsIncludeGroup · nextMailActivityAtMs · isMailGroupRecentlyActive
// [POS] `📧 邮件专用` 按需探测的活动判定纯函数：只有邮件组最近被用过才复测当前节点。

/** 邮件组最近一次活动后的观察窗口：窗口内继续按需复测，避免节点刚挂掉就停止探测。 */
export const MAIL_ACTIVITY_WINDOW_MS = 30 * 60 * 1000

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
export function nextMailActivityAtMs(
  lastActiveAtMs: number,
  activeNow: boolean,
  nowMs: number
): number {
  return activeNow ? nowMs : lastActiveAtMs
}

/** 最近一次邮件活动是否仍在观察窗口内。 */
export function isMailGroupRecentlyActive(
  lastActiveAtMs: number,
  nowMs: number,
  windowMs: number = MAIL_ACTIVITY_WINDOW_MS
): boolean {
  return lastActiveAtMs > 0 && nowMs - lastActiveAtMs < windowMs
}
