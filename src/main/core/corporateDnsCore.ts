/**
 * Office resolvers used alongside `dhcp://`. mihomo races every upstream and a failed
 * `dhcp://` (interface without IPv4) is an error, not an answer, so these take over
 * when the default interface changed after the config was generated.
 */
export const CORPORATE_STATIC_NAMESERVERS = ['10.200.150.212', '10.200.150.211'] as const

/** Only physical interfaces hold a DHCP lease; utun/bridge would make `dhcp://` error out. */
const PHYSICAL_INTERFACE_RE = /^en\d+$/

/** Parse `route -n get default` output: `interface: en0`. */
export function parseDefaultInterface(output: string): string | undefined {
  return output.match(/^\s*interface:\s*(\S+)/m)?.[1]
}

/**
 * `dhcp://<iface>` makes mihomo follow the live DHCP lease of that interface, so the
 * resolver tracks the current network instead of a snapshot taken at generation time.
 */
export function buildCorporateNameservers(defaultInterface: string | undefined): string[] {
  const dhcp =
    defaultInterface && PHYSICAL_INTERFACE_RE.test(defaultInterface)
      ? [`dhcp://${defaultInterface}`]
      : []
  return [...dhcp, ...CORPORATE_STATIC_NAMESERVERS]
}
