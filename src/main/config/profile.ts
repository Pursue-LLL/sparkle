import { getControledMihomoConfig } from './controledMihomo'
import { mihomoProfileWorkDir, mihomoWorkDir, profileConfigPath, profilePath } from '../utils/dirs'
import { addProfileUpdater, delProfileUpdater } from '../core/profileUpdater'
import { existsSync } from 'fs'
import { readFile, writeFile, rm, mkdir } from 'fs/promises'
import { fileToStr } from '@uruhalushia/sparkle-native'
import { restartCore } from '../core/manager'
import { getAppConfig } from './app'
import axios, { AxiosResponse } from 'axios'
import https from 'https'
import http from 'http'
import tls from 'tls'
import crypto from 'crypto'
import { URL } from 'url'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { defaultProfile } from '../utils/template'
import { subStorePort } from '../resolve/server'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { deepMerge } from '../utils/merge'
import { getUserAgent } from '../utils/userAgent'
import { execWithElevation } from '../utils/elevation'
import { deleteProvider } from '../core/provider'
import { findDependentMergeItems } from '../core/mergeProfileCore'
import { normalizeSubscriptionExpireTimestamp } from '../core/profileSubscriptionDisplayCore'
import {
  isBlankProfileConfigRaw,
  isEmptyPersistableProfileConfig,
  recoverProfileConfigFromDisk
} from '../core/profileConfigRecoveryCore'
import {
  formatMissingSubscriptionUrlError,
  readProfileDiskUpdatedMs,
  reloadCurrentProfileFromDiskCache
} from '../core/profileCacheRefreshCore'
import { appendAppLog } from '../utils/log'

let profileConfig: ProfileConfig // profile.yaml
const FILE_PERMISSION_ELEVATION_REQUIRED = 'FILE_PERMISSION_ELEVATION_REQUIRED'

export function getCertFingerprint(cert: tls.PeerCertificate) {
  return crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase()
}

export async function getProfileConfig(force = false): Promise<ProfileConfig> {
  if (force || !profileConfig) {
    const data = await readFile(profileConfigPath(), 'utf-8').catch(() => '')
    if (isBlankProfileConfigRaw(data)) {
      const recovered = await recoverProfileConfigFromDisk()
      if (recovered?.items?.length) {
        profileConfig = recovered
        await writeFile(profileConfigPath(), stringifyYaml(recovered), 'utf-8')
        await appendAppLog(
          `[ProfileConfig]: recovered profile.yaml from disk/backup items=${recovered.items.length} current=${recovered.current ?? 'unset'}\n`
        )
      } else {
        profileConfig = parseYaml(data) || { items: [] }
      }
    } else {
      profileConfig = parseYaml(data) || { items: [] }
    }
  }
  if (typeof profileConfig !== 'object') profileConfig = { items: [] }
  return profileConfig
}

export async function setProfileConfig(config: ProfileConfig): Promise<void> {
  const serialized = stringifyYaml(config)
  if (!serialized.trim()) {
    throw new Error('Refusing to write blank profile.yaml')
  }
  if (isEmptyPersistableProfileConfig(config)) {
    const recoverable = await recoverProfileConfigFromDisk()
    if (recoverable?.items?.length) {
      throw new Error(
        'Refusing to persist empty profile.yaml while subscription cache exists on disk'
      )
    }
  }
  profileConfig = config
  await writeFile(profileConfigPath(), serialized, 'utf-8')
}

export async function getProfileItem(id: string | undefined): Promise<ProfileItem | undefined> {
  const { items } = await getProfileConfig()
  if (!id || id === 'default') return { id: 'default', type: 'local', name: '空白订阅' }
  return items.find((item) => item.id === id)
}

export async function changeCurrentProfile(id: string): Promise<void> {
  const config = await getProfileConfig()
  const current = config.current
  config.current = id
  await setProfileConfig(config)
  try {
    await restartCore()
  } catch (e) {
    config.current = current
    throw e
  } finally {
    await setProfileConfig(config)
  }
}

export async function updateProfileItem(item: ProfileItem): Promise<void> {
  const config = await getProfileConfig()
  const index = config.items.findIndex((i) => i.id === item.id)
  if (index === -1) {
    throw new Error('Profile not found')
  }
  config.items[index] = item
  await setProfileConfig(config)
  if (!item.autoUpdate) {
    await delProfileUpdater(item.id)
  } else {
    await addProfileUpdater(item)
  }
}

export async function addProfileItem(item: Partial<ProfileItem>): Promise<void> {
  const newItem = await createProfile(item)
  const config = await getProfileConfig()
  if (await getProfileItem(newItem.id)) {
    await updateProfileItem(newItem)
  } else {
    config.items.push(newItem)
  }
  await setProfileConfig(config)

  if (!config.current) {
    await changeCurrentProfile(newItem.id)
  }
  await addProfileUpdater(newItem)
}

export async function removeProfileItem(id: string): Promise<void> {
  const config = await getProfileConfig()
  // 来源被删后合并订阅无法再重建，只会悄悄停在旧节点上，因此直接拒绝删除。
  const referencedBy = findDependentMergeItems(config.items, id)
  if (referencedBy.length > 0) {
    throw new Error(
      `订阅正被合并订阅引用：${referencedBy.map((item) => item.name).join('、')}，请先删除合并订阅`
    )
  }
  config.items = config.items?.filter((item) => item.id !== id)
  let shouldRestart = false
  if (config.current === id) {
    shouldRestart = true
    if (config.items.length > 0) {
      config.current = config.items[0].id
    } else {
      config.current = undefined
    }
  }
  await setProfileConfig(config)
  if (existsSync(profilePath(id))) {
    await rm(profilePath(id))
  }
  await deleteProvider(id)
  if (shouldRestart) {
    await restartCore()
  }
  if (existsSync(mihomoProfileWorkDir(id))) {
    await rm(mihomoProfileWorkDir(id), { recursive: true })
  }
  await delProfileUpdater(id)
}

export async function getCurrentProfileItem(): Promise<ProfileItem> {
  const { current } = await getProfileConfig()
  return (await getProfileItem(current)) || { id: 'default', type: 'local', name: '空白订阅' }
}

export async function createProfile(item: Partial<ProfileItem>): Promise<ProfileItem> {
  const id = item.id || new Date().getTime().toString(16)
  const newItem = {
    id,
    name: item.name || (item.type === 'remote' ? 'Remote File' : 'Local File'),
    type: item.type,
    url: item.url,
    fingerprint: item.fingerprint,
    ua: item.ua,
    merge: item.merge,
    verify: item.verify ?? false,
    autoUpdate: item.autoUpdate ?? true,
    disableRemoteInterval: item.disableRemoteInterval ?? false,
    substore: item.substore || false,
    interval: item.interval || 0,
    updateTime: item.updateTime,
    override: item.override || [],
    useProxy: item.useProxy || false,
    updated: new Date().getTime()
  } as ProfileItem
  switch (newItem.type) {
    case 'remote': {
      const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
      if (!item.url) {
        if (existsSync(profilePath(id))) {
          const { current } = await getProfileConfig()
          if (current === id) {
            await reloadCurrentProfileFromDiskCache(id)
          }
          const diskUpdatedMs = await readProfileDiskUpdatedMs(id)
          if (diskUpdatedMs) {
            newItem.updated = diskUpdatedMs
          }
          break
        }
        throw new Error(formatMissingSubscriptionUrlError())
      }
      let res: AxiosResponse
      if (newItem.substore) {
        const urlObj = new URL(`http://127.0.0.1:${subStorePort}${item.url}`)
        urlObj.searchParams.set('target', 'ClashMeta')
        urlObj.searchParams.set('noCache', 'true')
        if (newItem.useProxy && mixedPort != 0) {
          urlObj.searchParams.set('proxy', `http://127.0.0.1:${mixedPort}`)
        } else {
          urlObj.searchParams.delete('proxy')
        }
        res = await axios.get(urlObj.toString(), {
          headers: {
            'User-Agent': await getUserAgent()
          },
          responseType: 'text'
        })
      } else {
        try {
          const httpsAgent = new https.Agent({ rejectUnauthorized: !item.fingerprint })

          if (item.fingerprint) {
            const expected = item.fingerprint.replace(/:/g, '').toUpperCase()
            const verify = (s: tls.TLSSocket) => {
              if (getCertFingerprint(s.getPeerCertificate()) !== expected)
                s.destroy(new Error('证书指纹不匹配'))
            }

            if (newItem.useProxy && mixedPort != 0) {
              const urlObj = new URL(item.url)
              const hostname = urlObj.hostname
              const port = urlObj.port || '443'
              httpsAgent.createConnection = (_, cb) => {
                const req = http.request({
                  host: '127.0.0.1',
                  port: mixedPort,
                  method: 'CONNECT',
                  path: `${hostname}:${port}`
                })

                req.on('connect', (res, sock, head) => {
                  if (res.statusCode !== 200) {
                    cb?.(new Error(`代理连接失败，状态码：${res.statusCode}`), null!)
                    return
                  }
                  if (head.length > 0) sock.unshift(head)
                  const tls$ = tls.connect(
                    { socket: sock, servername: hostname, rejectUnauthorized: false },
                    () => verify(tls$)
                  )
                  cb?.(null, tls$)
                })

                req.on('error', (e) => cb?.(e, null!))
                req.end()
                return null!
              }
            } else {
              const conn = httpsAgent.createConnection.bind(httpsAgent)
              httpsAgent.createConnection = (o, c) => {
                const sock = conn(o, c)
                sock?.once('secureConnect', function (this: tls.TLSSocket) {
                  verify(this)
                })
                return sock
              }
            }
          }

          res = await axios.get(item.url, {
            httpsAgent,
            ...(newItem.useProxy &&
              mixedPort &&
              !item.fingerprint && {
                proxy: { protocol: 'http', host: '127.0.0.1', port: mixedPort }
              }),
            headers: { 'User-Agent': newItem.ua || (await getUserAgent()) },
            responseType: 'text'
          })
        } catch (error) {
          if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
              throw new Error(`网络连接被重置或超时：${item.url}`)
            } else if (error.code === 'CERT_HAS_EXPIRED') {
              throw new Error(`服务器证书已过期：${item.url}`)
            } else if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
              throw new Error(`无法验证服务器证书：${item.url}`)
            } else if (error.message.includes('Certificate verification failed')) {
              throw new Error(`证书验证失败：${item.url}`)
            } else {
              throw new Error(`请求失败：${error.message}`)
            }
          }
          throw error
        }
      }

      const data = res.data
      const headers = res.headers
      const contentDispositionKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('content-disposition')
      )
      if (contentDispositionKey && newItem.name === 'Remote File') {
        newItem.name = parseFilename(headers[contentDispositionKey])
      }
      const homeKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('profile-web-page-url')
      )
      if (homeKey) {
        newItem.home = headers[homeKey]
      }
      const intervalKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('profile-update-interval')
      )
      if (intervalKey && !newItem.disableRemoteInterval) {
        newItem.interval = parseInt(headers[intervalKey]) * 60
        if (newItem.interval) {
          newItem.locked = true
        }
      } else if (newItem.disableRemoteInterval) {
        newItem.locked = false
      }
      const userinfoKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('subscription-userinfo')
      )
      if (userinfoKey) {
        newItem.extra = parseSubinfo(headers[userinfoKey])
      }
      if (newItem.verify) {
        try {
          parseYaml<MihomoConfig>(data)
        } catch (error) {
          throw new Error('订阅格式错误，无法解析为有效的配置文件\n' + (error as Error).message)
        }
      }
      await setProfileStr(id, data)
      break
    }
    case 'local': {
      const data = item.merge
        ? await (await import('./mergeProfile')).buildMergeProfileYaml(item.merge)
        : item.file || ''
      await setProfileStr(id, data)
      break
    }
  }
  return newItem
}

export async function getProfileStr(id: string | undefined): Promise<string> {
  if (existsSync(profilePath(id || 'default'))) {
    return await readFile(profilePath(id || 'default'), 'utf-8')
  } else {
    return stringifyYaml(defaultProfile)
  }
}

export async function getProfileParseStr(id: string | undefined): Promise<string> {
  let data: string
  if (existsSync(profilePath(id || 'default'))) {
    data = await readFile(profilePath(id || 'default'), 'utf-8')
  } else {
    data = stringifyYaml(defaultProfile)
  }
  const profile = deepMerge(parseYaml<object>(data), {})
  return stringifyYaml(profile)
}

export async function setProfileStr(id: string, content: string): Promise<void> {
  await applyProfileStr(id, content)
  const { rebuildDependentMergeProfiles } = await import('./mergeProfile')
  await rebuildDependentMergeProfiles(id)
}

/** 写入订阅文件并在其为当前订阅时热重载；不触发合并订阅重建（合并订阅自身的写入走这里）。 */
export async function applyProfileStr(id: string, content: string): Promise<void> {
  const { current } = await getProfileConfig()
  await writeFile(profilePath(id), content, 'utf-8')

  if (current === id) {
    try {
      const { readMarathonCoreRestartGuardSnapshot } = await import('../core/marathonCoreRestartGuard')
      const { getMarathonQuiesceSnapshot } = await import('../core/marathonQuiesce')
      const { shouldDeferProfileProviderReload } = await import('../core/appConfigMihomoReloadGuardCore')
      const guardSnapshot = await readMarathonCoreRestartGuardSnapshot()
      const quiesceSnapshot = getMarathonQuiesceSnapshot()
      if (
        shouldDeferProfileProviderReload({
          quiesceActive: quiesceSnapshot.active,
          cursorConnectionCount: guardSnapshot.cursorConnectionCount,
          recentActiveLifecycleStreamCount: guardSnapshot.recentActiveLifecycleStreamCount,
        })
      ) {
        return
      }
    } catch {
      // Fall through to legacy reload when guard snapshot unavailable.
    }
    // Rebuild merged profile (subscription + global override VPS) then hot-reload provider.
    // Raw updateProvider() alone drops override leaf nodes on scheduled subscription refresh.
    try {
      const { generateProfile, getRuntimeConfig } = await import('../core/factory')
      const { reloadMihomoProfileProviders, resolveVpsProviderId } = await import('../core/provider')
      await generateProfile()
      const runtime = await getRuntimeConfig()
      const proxyProviders = runtime['proxy-providers'] as Record<string, unknown> | undefined
      const hasVpsProvider = Boolean(proxyProviders?.[resolveVpsProviderId(id)])
      await reloadMihomoProfileProviders(id, hasVpsProvider)
    } catch {
      await restartCore()
    }
  }
}

export async function getProfile(id: string | undefined): Promise<MihomoConfig> {
  const profile = await getProfileStr(id)
  let result = parseYaml<MihomoConfig>(profile)
  if (typeof result !== 'object') result = {} as MihomoConfig
  return result
}

// attachment;filename=xxx.yaml; filename*=UTF-8''%xx%xx%xx
function parseFilename(str: string): string {
  if (str.match(/filename\*=.*''/)) {
    const filename = decodeURIComponent(str.split(/filename\*=.*''/)[1])
    return filename
  } else {
    const filename = str.split('filename=')[1]
    return filename
  }
}

// subscription-userinfo: upload=1234; download=2234; total=1024000; expire=2218532293
function parseSubinfo(str: string): SubscriptionUserInfo {
  const parts = str.split(';')
  const obj = {} as SubscriptionUserInfo
  parts.forEach((part) => {
    const [key, value] = part.trim().split('=')
    obj[key] = parseInt(value)
  })
  if (obj.expire) {
    const normalized = normalizeSubscriptionExpireTimestamp(obj.expire)
    if (normalized) {
      obj.expire = normalized
    }
  }
  return obj
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\\/.test(path)
}

function resolveEditableFilePath(
  path: string,
  current: string | undefined,
  diffWorkDir: boolean
): string {
  if (isAbsolutePath(path)) {
    return path
  }
  return join(diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), path)
}

function isSubPath(base: string, target: string): boolean {
  const relativePath = relative(resolve(base), resolve(target))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = 'code' in error ? error.code : undefined
  return code === 'EACCES' || code === 'EPERM'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function isManagedEditableFile(target: string, current: string | undefined): boolean {
  return [mihomoWorkDir(), mihomoProfileWorkDir(current)].some((root) => isSubPath(root, target))
}

function buildPermissionRepairCommand(
  target: string,
  uid: number,
  gid: number,
  repairParent: boolean
): string {
  const parts = [`t=${shellQuote(target)}`]

  if (repairParent) {
    parts.push(`p=${shellQuote(dirname(target))}`)
    parts.push(`mkdir -p "$p"`)
    parts.push(`chown ${uid}:${gid} "$p"`)
    parts.push(`chmod u+rwx "$p"`)
  }

  parts.push(`[ ! -e "$t" ] || { chown ${uid}:${gid} "$t" && chmod u+rw "$t"; }`)
  return parts.join('; ')
}

async function repairEditableFilePermissions(
  target: string,
  current: string | undefined
): Promise<void> {
  const repairParent = process.platform !== 'win32' && isManagedEditableFile(target, current)
  if (!repairParent) {
    return
  }

  const uid = process.getuid?.()
  const gid = process.getgid?.()
  if (uid == null || gid == null) {
    return
  }

  await execWithElevation('sh', [
    '-c',
    buildPermissionRepairCommand(target, uid, gid, repairParent)
  ])
}

async function attemptWriteFile(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf-8')
}

async function writeEditableFile(
  target: string,
  content: string,
  current: string | undefined,
  elevate = false
): Promise<void> {
  try {
    await attemptWriteFile(target, content)
  } catch (error) {
    if (!isPermissionError(error)) {
      throw error
    }

    if (!elevate) {
      if (process.platform !== 'win32' && isManagedEditableFile(target, current)) {
        throw new Error(FILE_PERMISSION_ELEVATION_REQUIRED)
      }
      throw error
    }

    await repairEditableFilePermissions(target, current)
    await attemptWriteFile(target, content)
  }
}

export async function getFileStr(path: string): Promise<string> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  return await readFile(resolveEditableFilePath(path, current, diffWorkDir), 'utf-8')
}

export async function getFilePreviewStr(path: string, format?: string): Promise<string> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  const target = resolveEditableFilePath(path, current, diffWorkDir)
  if (format !== 'MrsRule') {
    return await readFile(target, 'utf-8')
  }

  return await convertMrsRuleToText(target)
}

async function convertMrsRuleToText(path: string): Promise<string> {
  const result = fileToStr(path, {
    outputTarget: 'mihomo',
    outputFormat: 'text',
    outputBehavior: 'auto'
  })
  let text = ''
  for (const output of Object.values(result.outputs)) {
    text += text ? `\n${output}` : output
  }
  if (!text) {
    return ''
  }
  return text
}

export async function setFileStr(path: string, content: string): Promise<void> {
  return await saveFileStr(path, content, false)
}

export async function saveFileStrWithElevation(path: string, content: string): Promise<void> {
  return await saveFileStr(path, content, true)
}

async function saveFileStr(path: string, content: string, elevate: boolean): Promise<void> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  const target = resolveEditableFilePath(path, current, diffWorkDir)
  await writeEditableFile(target, content, current, elevate)
}
