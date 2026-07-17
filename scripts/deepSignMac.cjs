const { execFileSync } = require('node:child_process')
const path = require('node:path')

/** Re-sign the .app bundle so main binary + Electron Framework share one adhoc identity (fixes DYLD Team ID mismatch). */
exports.default = async function deepSignMac(context) {
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], { stdio: 'inherit' })
  try {
    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })
  } catch {
    // sidecar binaries may be root-owned from prepare; ignore xattr failures
  }
}
