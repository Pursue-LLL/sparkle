import { CURSOR_DELAY_TEST_URL } from './cursorProxyGroup'

const DEFAULT_PROVIDER_HEALTH_CHECK_URL = 'http://www.gstatic.com/generate_204'

function isVpsLeafProxy(proxy: unknown): boolean {
  if (typeof proxy !== 'object' || proxy === null) {
    return false
  }
  const name = (proxy as Record<string, unknown>).name
  return typeof name === 'string' && /vps/i.test(name)
}

/** VPS provider health checks should target api2 — same plane as Cursor marathon traffic. */
export function resolveProviderHealthCheckUrl(proxies: unknown[]): string {
  if (proxies.some(isVpsLeafProxy)) {
    return CURSOR_DELAY_TEST_URL
  }
  return DEFAULT_PROVIDER_HEALTH_CHECK_URL
}
