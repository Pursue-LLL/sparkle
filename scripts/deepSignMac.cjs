const { execFileSync } = require('node:child_process')
const path = require('node:path')

/**
 * Re-sign the .app bundle so main binary + Electron Framework share one adhoc identity (fixes DYLD Team ID mismatch).
 * electron-builder emits afterSign for Windows targets too (its Windows packager reports success once it has
 * processed the exe), and codesign only exists on macOS, so every other platform is left untouched.
 */
exports.default = async function deepSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], { stdio: 'inherit' })
  try {
    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })
  } catch {
    // sidecar binaries may be root-owned from prepare; ignore xattr failures
  }
}
