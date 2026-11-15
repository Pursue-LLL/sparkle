import { type ChildProcess, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * 安装流水线沙箱：把真实的安装脚本复制进临时目录，PATH 只暴露白名单里的真实工具和命令桩，
 * 因此任何一个没被桩住的特权命令（launchctl、osascript、pkill……）都会表现为「command not found」，
 * 而不是碰到真实系统。文件系统命令保持真实，事务靠的 rename 语义才是被测对象。
 * 命令桩见 sandbox-stub.sh。
 */

const SCRIPTS_DIR = join(import.meta.dirname, '..')
const STUB_SCRIPT = join(import.meta.dirname, 'sandbox-stub.sh')

/** 脚本会用到的真实命令；缺一个测试就会以 command not found 失败，从而发现遗漏。 */
const REAL_TOOLS = [
  'awk',
  'basename',
  'bash',
  'cat',
  'chmod',
  'cmp',
  'cp',
  'cut',
  'date',
  'dirname',
  'du',
  'find',
  'grep',
  'head',
  'id',
  'kill',
  'ls',
  'mkdir',
  'mktemp',
  'sed',
  'sort',
  'stat',
  'tail',
  'touch',
  'tr',
  'wc',
  'xattr',
  'xargs'
] as const

/** 命令桩；全部指向同一个分发脚本。 */
const STUBBED_TOOLS = [
  'codesign',
  'curl',
  'defaults',
  'df',
  'ditto',
  'dscl',
  'launchctl',
  'mv',
  'nc',
  'osascript',
  'pgrep',
  'pkill',
  'ps',
  'rm',
  'sleep',
  'spctl',
  'sw_vers',
  'uname'
] as const

export interface BundleSpec {
  version: string
  cdhash: string
  serviceBinary?: string
  coreSetuid?: boolean
  /** 写入 Contents/Resources/sim-behavior；键含义见 sandbox-stub.sh 的 behavior()。 */
  behavior?: Record<string, string>
}

export interface WorldSpec {
  mode: 'service' | 'elevated'
  tun: boolean
  /** config.yaml 的 macos26ForceGui；默认 true（GUI 应当常驻）。 */
  forceGui?: boolean
  /** `uname -r` 的返回值，默认 macOS 26。 */
  darwin?: string
  /** 已安装的旧包；null 表示全新安装。 */
  old: BundleSpec | null
  next: BundleSpec
  /** 旧 App 与内核是否正在运行，默认 true。 */
  oldRunning?: boolean
  /** 外部网络是否通，默认 true。 */
  network?: 'ok' | 'down'
}

export interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  output: string
}

export interface RunningInstall {
  pid: number
  child: ChildProcess
  done: Promise<RunResult>
  /** 到目前为止的输出；常驻进程（看门狗）没有「结束」，只能边跑边看。 */
  output: () => string
}

export function writeBundle(dir: string, spec: BundleSpec): void {
  const contents = join(dir, 'Contents')
  const sidecar = join(contents, 'Resources', 'sidecar')
  const files = join(contents, 'Resources', 'files')
  for (const sub of [join(contents, 'MacOS'), sidecar, files]) {
    mkdirSync(sub, { recursive: true })
  }
  writeFileSync(join(contents, 'version'), `${spec.version}\n`)
  writeFileSync(join(contents, 'CDHASH'), `${spec.cdhash}\n`)
  writeFileSync(join(contents, 'MacOS', 'Sparkle'), '#!/bin/sh\n')
  writeFileSync(join(files, 'sparkle-service'), spec.serviceBinary ?? 'service-v1')
  chmodSync(join(files, 'sparkle-service'), 0o755)
  for (const core of ['mihomo', 'mihomo-alpha']) {
    writeFileSync(join(sidecar, core), `core ${spec.version}\n`)
    chmodSync(join(sidecar, core), spec.coreSetuid ? 0o4755 : 0o755)
  }
  const behavior = Object.entries(spec.behavior ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  writeFileSync(join(contents, 'Resources', 'sim-behavior'), `${behavior}\n`)
}

/**
 * 目录的完整指纹：每个文件的相对路径、权限位（含 setuid）与内容哈希。
 * 回滚前后一致，说明放回去的就是原来那份字节，而不是「看起来差不多」的副本。
 */
export function bundleFingerprint(dir: string): string {
  const lines: string[] = []
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else {
        const digest = createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 16)
        lines.push(`${relative(dir, full)} ${(stat.mode & 0o7777).toString(8)} ${digest}`)
      }
    }
  }
  walk(dir)
  return lines.join('\n')
}

export class InstallSandbox {
  readonly root = mkdtempSync(join(tmpdir(), 'sparkle-install-sandbox-'))
  readonly repo = join(this.root, 'repo')
  readonly apps = join(this.root, 'apps')
  readonly dest = join(this.apps, 'Sparkle.app')
  readonly src = join(this.repo, 'dist', 'mac-arm64', 'Sparkle.app')
  readonly home = join(this.root, 'home')
  readonly stateDir = join(this.home, '.sparkle')
  readonly appDataDir = join(this.home, 'Library', 'Application Support', 'sparkle')
  readonly launchAgentsDir = join(this.home, 'Library', 'LaunchAgents')
  readonly simDir = join(this.root, 'sim')
  readonly binDir = join(this.root, 'bin')
  readonly pidFile = join(this.root, 'installer.pid')

  constructor(readonly spec: WorldSpec) {
    for (const dir of [
      this.apps,
      this.stateDir,
      this.appDataDir,
      this.launchAgentsDir,
      this.simDir
    ]) {
      mkdirSync(dir, { recursive: true })
    }
    mkdirSync(join(this.root, 'tmp'))
    this.copyScripts()
    this.linkTools()
    this.writeConfig()
    writeBundle(this.src, spec.next)
    if (spec.old) {
      writeBundle(this.dest, spec.old)
      this.startOldRuntime(spec.old)
    }
    writeFileSync(join(this.simDir, 'network'), spec.network ?? 'ok')
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true })
  }

  private copyScripts(): void {
    cpSync(SCRIPTS_DIR, join(this.repo, 'scripts'), {
      recursive: true,
      filter: (path) => !path.includes('/testing') && !/\.(ts|mts|md|json)$/.test(path)
    })
    mkdirSync(join(this.repo, 'node_modules', '.bin'), { recursive: true })
    symlinkSync(STUB_SCRIPT, join(this.repo, 'node_modules', '.bin', 'tsx'))
  }

  private linkTools(): void {
    mkdirSync(this.binDir)
    for (const tool of REAL_TOOLS) {
      const real = ['/bin', '/usr/bin'].map((d) => join(d, tool)).find((p) => existsSync(p))
      if (!real) throw new Error(`real tool missing on this machine: ${tool}`)
      symlinkSync(real, join(this.binDir, tool))
    }
    for (const tool of STUBBED_TOOLS) {
      symlinkSync(STUB_SCRIPT, join(this.binDir, tool))
    }
  }

  private writeConfig(): void {
    const { mode, tun, forceGui = true } = this.spec
    writeFileSync(
      join(this.appDataDir, 'config.yaml'),
      `core: mihomo\ncorePermissionMode: ${mode}\nmacos26ForceGui: ${forceGui}\n`
    )
    writeFileSync(join(this.appDataDir, 'mihomo.yaml'), `tun:\n  enable: ${tun}\n`)
  }

  /** 旧 App 正在运行：GUI 与内核都在，内核启动于一小时前，日志里留着一条旧的 TUN 行。 */
  private startOldRuntime(old: BundleSpec): void {
    const logs = join(this.appDataDir, 'logs')
    mkdirSync(logs, { recursive: true })
    writeFileSync(join(logs, 'core-2026-11-15.log'), '[TUN] Tun adapter listening at: utun8\n')
    if (this.spec.oldRunning === false) {
      writeFileSync(join(this.simDir, 'proxy'), 'down')
      return
    }
    writeFileSync(join(this.simDir, 'gui.pid'), '4242')
    writeFileSync(join(this.simDir, 'core.pid'), '5151')
    writeFileSync(
      join(this.simDir, 'core.path'),
      join(this.dest, 'Contents/Resources/sidecar/mihomo')
    )
    writeFileSync(join(this.simDir, 'core.start'), String(Math.floor(Date.now() / 1000) - 3600))
    writeFileSync(join(this.simDir, 'core.traffic'), old.behavior?.traffic ?? 'ok')
    writeFileSync(join(this.simDir, 'proxy'), 'up')
  }

  env(extra: Record<string, string> = {}): Record<string, string> {
    return {
      PATH: this.binDir,
      HOME: this.home,
      TMPDIR: join(this.root, 'tmp'),
      SIM_DIR: this.simDir,
      SIM_INSTALLER_PID_FILE: this.pidFile,
      SIM_LOGIN_HOME: this.home,
      SIM_DARWIN: this.spec.darwin ?? '25.5.0',
      SPARKLE_INSTALL_DEST: this.dest,
      SPARKLE_INSTALL_SRC: this.src,
      SPARKLE_STATE_DIR: this.stateDir,
      SPARKLE_APP_DATA_DIR: this.appDataDir,
      SPARKLE_LAUNCH_AGENTS_DIR: this.launchAgentsDir,
      SPARKLE_SERVICE_SOCKET: join(this.root, 'no-such.sock'),
      SPARKLE_GATE_POLL_SEC: '1',
      SPARKLE_GATE_TIMEOUT_SEC: '3',
      SPARKLE_QUIT_TIMEOUT_SEC: '2',
      SPARKLE_LAUNCH_WAIT_SEC: '2',
      SPARKLE_NONINTERACTIVE: '0',
      ...extra
    }
  }

  /** 启动一次安装；`shell` 默认用系统自带的 bash 3.2，这是兼容性最严格的解释器。 */
  start(
    extraEnv: Record<string, string> = {},
    script = 'install-sparkle-local.sh',
    shell = '/bin/bash'
  ): RunningInstall {
    const child = spawn(
      shell,
      [
        '-c',
        'echo $$ > "$SIM_INSTALLER_PID_FILE"; exec "$SIM_SHELL" "$0"',
        join(this.repo, 'scripts', script)
      ],
      {
        env: { ...this.env(extraEnv), SIM_SHELL: shell },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const killer = setTimeout(() => process.kill(-(child.pid ?? 0), 'SIGKILL'), 120_000)
    const done = new Promise<RunResult>((resolve) => {
      child.on('close', (code, signal) => {
        clearTimeout(killer)
        resolve({ code, signal, output })
      })
    })
    return { pid: child.pid ?? 0, child, done, output: () => output }
  }

  run(
    extraEnv: Record<string, string> = {},
    script = 'install-sparkle-local.sh',
    shell = '/bin/bash'
  ): Promise<RunResult> {
    return this.start(extraEnv, script, shell).done
  }

  // ---- 观察 ----

  guiRunning(): boolean {
    return existsSync(join(this.simDir, 'gui.pid'))
  }

  coreRunning(): boolean {
    return existsSync(join(this.simDir, 'core.pid'))
  }

  corePath(): string | null {
    return this.readSim('core.path')
  }

  proxy(): string | null {
    return this.readSim('proxy')
  }

  readSim(name: string): string | null {
    const file = join(this.simDir, name)
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
  }

  /** 命令桩的调用记录，每行 `命令 参数…`。 */
  calls(): string[] {
    const file = join(this.simDir, 'calls.log')
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
  }

  callsOf(name: string): string[] {
    return this.calls().filter((line) => line.startsWith(`${name} `))
  }

  firstCallIndex(predicate: (line: string) => boolean): number {
    return this.calls().findIndex(predicate)
  }

  destVersion(): string | null {
    const file = join(this.dest, 'Contents', 'version')
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
  }

  /** DEST 同目录下除安装目标本身之外的条目：暂存、备份、失败品不应残留。 */
  scratchEntries(): string[] {
    return readdirSync(this.apps).filter((name) => name !== basename(this.dest))
  }

  hasState(name: 'upgrade-state' | 'upgrade-in-progress'): boolean {
    return existsSync(join(this.stateDir, name))
  }

  /** 阶段文件里的 phase；没有阶段文件时为 null。 */
  phase(): string | null {
    const file = join(this.stateDir, 'upgrade-state')
    if (!existsSync(file)) return null
    return /^phase=(.*)$/m.exec(readFileSync(file, 'utf8'))?.[1] ?? null
  }

  /** 等命令桩在 SIM_HOLD_AT 指定的点停住（安装进程此刻一定在那一步里）。 */
  async waitUntilHeld(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!existsSync(join(this.simDir, 'held'))) {
      if (Date.now() > deadline) throw new Error('installer never reached the hold point')
      await delay(25)
    }
  }

  releaseHold(): void {
    writeFileSync(join(this.simDir, 'release'), '')
  }

  installLog(): string {
    const file = join(this.stateDir, 'install-last.log')
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }

  coreSetuidBit(app = this.dest): boolean {
    return (statSync(join(app, 'Contents/Resources/sidecar/mihomo')).mode & 0o4000) !== 0
  }
}

export const OLD_BUNDLE: BundleSpec = {
  version: '1.0.0-old',
  cdhash: 'aaaa1111',
  serviceBinary: 'service-v1'
}
export const NEW_BUNDLE: BundleSpec = {
  version: '1.1.0-new',
  cdhash: 'bbbb2222',
  serviceBinary: 'service-v2'
}

export function serviceWorld(overrides: Partial<WorldSpec> = {}): WorldSpec {
  return { mode: 'service', tun: true, old: OLD_BUNDLE, next: NEW_BUNDLE, ...overrides }
}
