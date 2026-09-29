type OutboundMode = 'rule' | 'global' | 'direct'
type LogLevel = 'info' | 'debug' | 'warning' | 'error' | 'silent'
type SysProxyMode = 'auto' | 'manual'
type CardStatus = 'col-span-2' | 'col-span-1' | 'hidden'
type AppTheme = 'system' | 'light' | 'dark'
type Priority =
  | 'PRIORITY_LOW'
  | 'PRIORITY_BELOW_NORMAL'
  | 'PRIORITY_NORMAL'
  | 'PRIORITY_ABOVE_NORMAL'
  | 'PRIORITY_HIGH'
  | 'PRIORITY_HIGHEST'

type MihomoGroupType = 'Selector' | 'Fallback' | 'URLTest' | 'LoadBalance' | 'Relay'
type MihomoProxyType =
  | 'Direct'
  | 'Reject'
  | 'RejectDrop'
  | 'Compatible'
  | 'Pass'
  | 'Dns'
  | 'Relay'
  | 'Selector'
  | 'Fallback'
  | 'URLTest'
  | 'LoadBalance'
  | 'Shadowsocks'
  | 'ShadowsocksR'
  | 'Snell'
  | 'Socks5'
  | 'Http'
  | 'Vmess'
  | 'Vless'
  | 'Trojan'
  | 'Hysteria'
  | 'Hysteria2'
  | 'WireGuard'
  | 'Tuic'
  | 'Ssh'
  | 'Mieru'
  | 'AnyTLS'
  | 'Sudoku'
  | 'Masque'
  /** Placeholder mihomo reports for a proxy whose protocol it does not expose. */
  | 'Unknown'
type TunStack = 'gvisor' | 'mixed' | 'system'
type FindProcessMode = 'off' | 'strict' | 'always'
type DnsMode = 'normal' | 'fake-ip' | 'redir-host'
type FilterMode = 'blacklist' | 'whitelist'
type NetworkInterfaceInfo = os.NetworkInterfaceInfo
type Fingerprints =
  | ''
  | 'random'
  | 'randomized'
  | 'chrome'
  | 'chrome_psk'
  | 'chrome_psk_shuffle'
  | 'chrome_padding_psk_shuffle'
  | 'chrome_pq'
  | 'chrome_pq_psk'
  | 'firefox'
  | 'safari'
  | 'ios'
  | 'android'
  | 'edge'
  | '360'
  | 'qq'

/** 与 src/main/core/mihomoProxyDelayCore.ts 的 MihomoDelayPurpose 保持一致。 */
interface MihomoDelayOptions {
  timeoutMs?: number
  purpose?:
    | 'default'
    | 'marathon_rescue'
    | 'user_explicit'
    | 'hy2_tunnel_vitality'
    | 'hy2_parent_sidecar'
    | 'tier0_provider_parity_hot_reload'
    | 'session_nudge'
}

interface ManagedVpsDelayTestOptions {
  explicitUserRequest?: boolean
}

interface ManagedVpsDelayTestResult {
  deferredMs: number
  proxyNames: string[]
  testUrl?: string
  delays: Record<string, ControllerProxiesDelay>
}
