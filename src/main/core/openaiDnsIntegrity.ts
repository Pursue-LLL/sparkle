const OVERSEAS_DOH = ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query'] as const

/** GFW-sensitive domains — force overseas DoH to avoid CN DNS pollution under TUN. */
export const PROXY_DOMAIN_NAMESERVER_POLICY: Readonly<Record<string, readonly string[]>> = {
  '+.google.com': OVERSEAS_DOH,
  '+.googleapis.com': OVERSEAS_DOH,
  '+.gstatic.com': OVERSEAS_DOH,
  '+.googlevideo.com': OVERSEAS_DOH,
  '+.openai.com': OVERSEAS_DOH,
  '+.chatgpt.com': OVERSEAS_DOH,
  '+.oaistatic.com': OVERSEAS_DOH,
  '+.oaiusercontent.com': OVERSEAS_DOH,
  '+.auth0.openai.com': OVERSEAS_DOH
}

/** @deprecated use PROXY_DOMAIN_NAMESERVER_POLICY */
export const OPENAI_NAMESERVER_POLICY = PROXY_DOMAIN_NAMESERVER_POLICY

export function mergeProxyDomainNameserverPolicy(
  existing: Record<string, string[]> | undefined
): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...(existing ?? {}) }
  for (const [domain, servers] of Object.entries(PROXY_DOMAIN_NAMESERVER_POLICY)) {
    merged[domain] = [...servers]
  }
  return merged
}

/** @deprecated use mergeProxyDomainNameserverPolicy */
export const mergeOpenAiNameserverPolicy = mergeProxyDomainNameserverPolicy

/** Runtime profile — inject OpenAI nameserver-policy after controlled DNS merge. */
export function ensureOpenAiDnsIntegrity(profile: MihomoConfig): void {
  if (!profile.dns?.enable) {
    return
  }
  const dns = profile.dns as MihomoDNSConfig
  dns['nameserver-policy'] = mergeProxyDomainNameserverPolicy(
    dns['nameserver-policy'] as Record<string, string[]> | undefined
  )
}
