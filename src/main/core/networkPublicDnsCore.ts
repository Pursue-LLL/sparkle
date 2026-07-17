export const PUBLIC_DNS_SERVERS = '223.5.5.5 1.1.1.1' as const

/** originDNS is captured once; public DNS must be applied on every TUN start. */
export function shouldPersistOriginDns(originDNS: string | undefined): boolean {
  return originDNS === undefined
}

export function publicDnsServerList(): string[] {
  return PUBLIC_DNS_SERVERS.split(' ')
}
