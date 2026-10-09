/** Delay heavy network probes after mihomo core ready — avoids cold-start races. */

export const NETWORK_MONITOR_STARTUP_GRACE_MS = 45_000
