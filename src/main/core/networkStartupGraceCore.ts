// [INPUT] 无本地依赖
// [OUTPUT] NETWORK_MONITOR_STARTUP_GRACE_MS
// [POS] 内核就绪后重型网络探测的启动宽限（45 秒），避开冷启动竞态。

/** Delay heavy network probes after mihomo core ready — avoids cold-start races. */

export const NETWORK_MONITOR_STARTUP_GRACE_MS = 45_000
