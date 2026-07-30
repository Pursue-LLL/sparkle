import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseDhcpDnsServersFromIpconfig } from './corporateDnsCore'

const execFileAsync = promisify(execFile)

async function getDefaultNetworkDevice(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('route', ['-n', 'get', 'default'])
    const line = stdout.split('\n').find((entry) => entry.includes('interface:'))
    const device = line?.trim().split(/\s+/).slice(1).join(' ')
    return device || undefined
  } catch {
    return undefined
  }
}

/** Read private DNS servers from current interface DHCP lease (office WiFi). */
export async function readDhcpPrivateDnsServers(): Promise<string[]> {
  const device = await getDefaultNetworkDevice()
  if (!device) {
    return []
  }

  try {
    const { stdout } = await execFileAsync('ipconfig', ['getpacket', device], { timeout: 3000 })
    return parseDhcpDnsServersFromIpconfig(stdout)
  } catch {
    return []
  }
}
