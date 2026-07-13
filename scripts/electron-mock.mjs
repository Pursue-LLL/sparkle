import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userData = path.join(os.homedir(), 'Library/Application Support/sparkle')

export const app = {
  getPath(name) {
    switch (name) {
      case 'home':
        return os.homedir()
      case 'userData':
        return userData
      case 'exe':
        return path.join(repoRoot, 'dist/mac-arm64/Sparkle.app/Contents/MacOS/Sparkle')
      case 'temp':
        return os.tmpdir()
      case 'appData':
        return path.join(os.homedir(), 'Library/Application Support')
      case 'desktop':
        return path.join(os.homedir(), 'Desktop')
      case 'documents':
        return path.join(os.homedir(), 'Documents')
      case 'downloads':
        return path.join(os.homedir(), 'Downloads')
      default:
        return userData
    }
  },
  getAppPath() {
    return path.join(repoRoot, 'dist/mac-arm64/Sparkle.app/Contents/Resources/app.asar')
  },
  isReady() {
    return true
  },
  whenReady() {
    return Promise.resolve()
  }
}

export const is = { dev: false }
