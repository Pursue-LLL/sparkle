import AdmZip from 'adm-zip'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const electronPackagePath = require.resolve('electron/package.json')
const electronDir = path.dirname(electronPackagePath)
const electronRequire = createRequire(path.join(electronDir, 'install.js'))
const { version } = electronRequire('./package.json') as { version: string }
const { downloadArtifact } = electronRequire('@electron/get') as {
  downloadArtifact: (options: {
    version: string
    artifactName: string
    force?: boolean
    cacheRoot?: string
    checksums?: Record<string, string>
    platform: NodeJS.Platform | string
    arch: string
  }) => Promise<string>
}

const platform =
  process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || os.platform()
const arch = process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || os.arch()
const distPath = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(electronDir, 'dist')
const platformPath = getPlatformPath(platform)
const pathFile = path.join(electronDir, 'path.txt')

function isDarwinPlatform(targetPlatform: string): boolean {
  return targetPlatform === 'darwin' || targetPlatform === 'mas'
}

function extractZipArchive(zipPath: string, targetDir: string, targetPlatform: string): void {
  if (isDarwinPlatform(targetPlatform)) {
    execFileSync('ditto', ['-xk', zipPath, targetDir], { stdio: 'inherit' })
    return
  }

  const zip = new AdmZip(zipPath)
  zip.extractAllTo(targetDir, true)
}

function isValidDarwinFramework(distRoot: string): boolean {
  const frameworkBinary = path.join(
    distRoot,
    'Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework'
  )

  try {
    return fs.lstatSync(frameworkBinary).isSymbolicLink()
  } catch {
    return false
  }
}
function getPlatformPath(targetPlatform: string): string {
  switch (targetPlatform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      throw new Error(`Electron builds are not available on platform: ${targetPlatform}`)
  }
}

function ensureExecutableBits(distPath: string, platformPath: string): void {
  const primaryBinary = path.join(distPath, platformPath)
  if (fs.existsSync(primaryBinary)) {
    fs.chmodSync(primaryBinary, 0o755)
  }

  if (process.platform !== 'darwin') {
    return
  }

  const appRoot = path.join(distPath, 'Electron.app')
  if (!fs.existsSync(appRoot)) {
    return
  }

  for (const entry of fs.readdirSync(path.join(appRoot, 'Contents', 'Frameworks'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.app')) {
      continue
    }
    const helperBinary = path.join(
      appRoot,
      'Contents',
      'Frameworks',
      entry.name,
      'Contents',
      'MacOS',
      entry.name.replace(/\.app$/, '')
    )
    if (fs.existsSync(helperBinary)) {
      fs.chmodSync(helperBinary, 0o755)
    }
  }
}

function isInstalled(): boolean {
  try {
    const installedVersion = fs
      .readFileSync(path.join(distPath, 'version'), 'utf-8')
      .replace(/^v/, '')
    const installedPath = fs.readFileSync(pathFile, 'utf-8')
    const hasPrimaryBinary =
      installedVersion === version &&
      installedPath === platformPath &&
      fs.existsSync(path.join(distPath, platformPath))

    if (!hasPrimaryBinary) {
      return false
    }

    if (isDarwinPlatform(platform)) {
      return isValidDarwinFramework(distPath)
    }

    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  if (isInstalled()) {
    return
  }

  console.log(`Installing Electron ${version} for ${platform}-${arch}...`)
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    force: process.env.force_no_cache === 'true',
    cacheRoot: process.env.electron_config_cache,
    checksums:
      process.env.electron_use_remote_checksums ||
      process.env.npm_config_electron_use_remote_checksums
        ? undefined
        : electronRequire('./checksums.json'),
    platform,
    arch
  })

  fs.rmSync(distPath, { recursive: true, force: true })
  fs.mkdirSync(distPath, { recursive: true })

  extractZipArchive(zipPath, distPath, platform)
  ensureExecutableBits(distPath, platformPath)

  const srcTypeDefPath = path.join(distPath, 'electron.d.ts')
  const targetTypeDefPath = path.join(electronDir, 'electron.d.ts')
  if (fs.existsSync(srcTypeDefPath)) {
    fs.renameSync(srcTypeDefPath, targetTypeDefPath)
  }

  await fs.promises.writeFile(pathFile, platformPath)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
