/** Collect main-process bundle text (disk out/main or packaged app.asar). */
import asar from '@electron/asar'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const MAIN_JS_PATH_RE = /^\/out\/main\/.*\.js$/

export function listSparkleMainProcessJsDiskPaths(mainOutDir: string): string[] {
  if (!existsSync(mainOutDir)) {
    return []
  }
  return readdirSync(mainOutDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(mainOutDir, name))
    .sort()
}

export function collectSparkleMainProcessDiskSource(mainOutDir: string): string {
  const absPaths = listSparkleMainProcessJsDiskPaths(mainOutDir)
  if (absPaths.length === 0) {
    throw new Error(`missing ${mainOutDir}/*.js`)
  }
  return absPaths.map((absPath) => readFileSync(absPath, 'utf8')).join('\n')
}

export function listSparkleMainProcessJsRelPaths(appAsarPath: string): string[] {
  return asar
    .listPackage(appAsarPath)
    .filter((entry) => MAIN_JS_PATH_RE.test(entry))
    .map((entry) => entry.slice(1))
    .sort()
}

export function collectSparkleMainProcessAsarSource(appAsarPath: string): string {
  const relPaths = listSparkleMainProcessJsRelPaths(appAsarPath)
  if (relPaths.length === 0) {
    throw new Error('asar missing out/main/*.js')
  }
  return relPaths.map((rel) => asar.extractFile(appAsarPath, rel).toString('utf8')).join('\n')
}
