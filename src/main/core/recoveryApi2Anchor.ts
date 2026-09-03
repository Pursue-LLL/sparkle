// [INPUT] recoveryApi2AnchorCore
// [OUTPUT] probeRecoveryApi2Anchor
// [POS] Runtime api2 anchor probe via local mixed-port proxy.

export async function probeRecoveryApi2Anchor(
  maxWaitMs: number = 10_000,
): Promise<boolean> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const timeoutSec = String(Math.max(3, Math.ceil(maxWaitMs / 1000)))
  try {
    await execFileAsync('curl', [
      '-sf',
      '--max-time',
      timeoutSec,
      '-x',
      'http://127.0.0.1:7890',
      'https://api2.cursor.sh/',
    ])
    return true
  } catch {
    return false
  }
}
