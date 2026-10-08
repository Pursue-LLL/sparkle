import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseDefaultInterface } from './corporateDnsCore'

const execFileAsync = promisify(execFile)

export async function readDefaultInterface(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('route', ['-n', 'get', 'default'], { timeout: 3000 })
    return parseDefaultInterface(stdout)
  } catch {
    return undefined
  }
}
