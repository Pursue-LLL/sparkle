import assert from 'node:assert/strict'
import fsPromises from 'node:fs/promises'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, after, before, beforeEach, describe, it, mock } from 'node:test'
import type {
  getFilePreviewStr,
  getFileStr,
  saveFileStrWithElevation,
  setFileStr
} from './profileFiles'
import {
  buildPermissionRepairCommand,
  FILE_PERMISSION_ELEVATION_REQUIRED
} from './profileFilesCore'

interface ProfileFiles {
  getFileStr: typeof getFileStr
  getFilePreviewStr: typeof getFilePreviewStr
  setFileStr: typeof setFileStr
  saveFileStrWithElevation: typeof saveFileStrWithElevation
}

type NativeOptions = { outputTarget: string; outputFormat: string; outputBehavior: string }

const state: {
  diffWorkDir: boolean | undefined
  current: string | undefined
  mrsOutputs: Record<string, string>
  elevated: Array<{ command: string; args: string[] }>
  mrsCalls: Array<{ file: string; options: NativeOptions }>
} = { diffWorkDir: false, current: undefined, mrsOutputs: {}, elevated: [], mrsCalls: [] }

function permissionError(code: 'EACCES' | 'EPERM'): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation not permitted`), { code })
}

describe('editable profile files', () => {
  let root: string
  let workDir: string
  let profileDir: string
  let files: ProfileFiles
  let writeAttempts: string[]
  let failWrites: Array<NodeJS.ErrnoException>
  let realWriteFile: typeof fsPromises.writeFile
  let restorers: Array<() => void>

  before(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'sparkle-profile-files-'))
    workDir = path.join(root, 'work')
    profileDir = path.join(root, 'profile-work')
    mkdirSync(workDir)
    mkdirSync(profileDir)
    realWriteFile = fsPromises.writeFile

    mock.module('../utils/dirs', {
      exports: {
        mihomoWorkDir: (): string => workDir,
        mihomoProfileWorkDir: (): string => profileDir
      }
    })
    mock.module('../utils/elevation', {
      exports: {
        execWithElevation: async (command: string, args: string[]): Promise<void> => {
          state.elevated.push({ command, args })
        }
      }
    })
    mock.module('./app', {
      exports: {
        getAppConfig: async (): Promise<{ diffWorkDir?: boolean }> => ({
          diffWorkDir: state.diffWorkDir
        })
      }
    })
    mock.module('./profile', {
      exports: {
        getProfileConfig: async (): Promise<{ current?: string }> => ({ current: state.current })
      }
    })
    mock.module(require.resolve('@uruhalushia/sparkle-native'), {
      exports: {
        fileToStr: (file: string, options: NativeOptions): { outputs: Record<string, string> } => {
          state.mrsCalls.push({ file, options })
          return { outputs: state.mrsOutputs }
        }
      }
    })
    files = await import('./profileFiles')
  })

  beforeEach(() => {
    state.diffWorkDir = false
    state.current = 'profile-1'
    state.mrsOutputs = {}
    state.elevated = []
    state.mrsCalls = []
    writeAttempts = []
    failWrites = []
    const writeFileSpy = mock.method(
      fsPromises,
      'writeFile',
      async (...args: Parameters<typeof fsPromises.writeFile>) => {
        writeAttempts.push(String(args[0]))
        const failure = failWrites.shift()
        if (failure) {
          throw failure
        }
        return realWriteFile(...args)
      }
    )
    restorers = [() => writeFileSpy.mock.restore()]
  })

  afterEach(() => {
    for (const restore of restorers) {
      restore()
    }
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  describe('reading', () => {
    it('resolves relative paths inside the work directory', async () => {
      writeFileSync(path.join(workDir, 'rules.yaml'), 'work', 'utf8')

      assert.equal(await files.getFileStr('rules.yaml'), 'work')
      assert.equal(await files.getFilePreviewStr('rules.yaml'), 'work')
    })

    it('resolves relative paths inside the profile work directory when it differs', async () => {
      state.diffWorkDir = true
      writeFileSync(path.join(profileDir, 'rules.yaml'), 'profile', 'utf8')

      assert.equal(await files.getFileStr('rules.yaml'), 'profile')
      assert.equal(await files.getFilePreviewStr('rules.yaml'), 'profile')
    })

    it('treats a never-configured profile work directory setting as off', async () => {
      state.diffWorkDir = undefined
      writeFileSync(path.join(workDir, 'rules.yaml'), 'work', 'utf8')
      writeFileSync(path.join(profileDir, 'rules.yaml'), 'profile', 'utf8')

      assert.equal(await files.getFileStr('rules.yaml'), 'work')
      assert.equal(await files.getFilePreviewStr('rules.yaml'), 'work')
    })

    it('reads absolute paths as they are', async () => {
      const outside = path.join(root, 'outside.txt')
      writeFileSync(outside, 'outside', 'utf8')

      assert.equal(await files.getFileStr(outside), 'outside')
    })

    it('rejects when the file does not exist', async () => {
      await assert.rejects(files.getFileStr('missing.yaml'), { code: 'ENOENT' })
    })
  })

  describe('rule-set (mrs) preview', () => {
    it('joins every converted output with a newline', async () => {
      state.mrsOutputs = { domain: 'DOMAIN,a.example', ip: 'IP-CIDR,10.0.0.0/8' }

      const text = await files.getFilePreviewStr('geo.mrs', 'MrsRule')

      assert.equal(text, 'DOMAIN,a.example\nIP-CIDR,10.0.0.0/8')
      assert.deepEqual(state.mrsCalls, [
        {
          file: path.join(workDir, 'geo.mrs'),
          options: { outputTarget: 'mihomo', outputFormat: 'text', outputBehavior: 'auto' }
        }
      ])
    })

    it('is empty when nothing could be converted', async () => {
      assert.equal(await files.getFilePreviewStr('geo.mrs', 'MrsRule'), '')
    })

    it('does not convert other formats', async () => {
      writeFileSync(path.join(workDir, 'plain.txt'), 'plain', 'utf8')

      assert.equal(await files.getFilePreviewStr('plain.txt', 'TextRule'), 'plain')
      assert.deepEqual(state.mrsCalls, [])
    })
  })

  describe('writing', () => {
    it('creates missing directories and writes the content', async () => {
      await files.setFileStr('nested/deeper/rules.yaml', 'rules: []')

      assert.equal(
        readFileSync(path.join(workDir, 'nested', 'deeper', 'rules.yaml'), 'utf8'),
        'rules: []'
      )
      assert.deepEqual(state.elevated, [])
    })

    it('writes into the profile work directory when it differs', async () => {
      state.diffWorkDir = true

      await files.setFileStr('rules.yaml', 'profile')

      assert.equal(readFileSync(path.join(profileDir, 'rules.yaml'), 'utf8'), 'profile')
    })

    it('writes into the work directory when the profile work directory setting was never configured', async () => {
      state.diffWorkDir = undefined

      await files.setFileStr('unset-setting.yaml', 'work')

      assert.equal(readFileSync(path.join(workDir, 'unset-setting.yaml'), 'utf8'), 'work')
      assert.equal(existsSync(path.join(profileDir, 'unset-setting.yaml')), false)
    })

    it('rethrows errors that are not about permissions', async () => {
      failWrites = [Object.assign(new Error('disk gone'), { code: 'EIO' })]

      await assert.rejects(files.setFileStr('rules.yaml', 'x'), { code: 'EIO' })
      assert.deepEqual(state.elevated, [])
    })

    for (const code of ['EACCES', 'EPERM'] as const) {
      it(`asks for elevation instead of failing when a managed file reports ${code}`, async () => {
        failWrites = [permissionError(code)]

        await assert.rejects(files.setFileStr('rules.yaml', 'x'), {
          message: FILE_PERMISSION_ELEVATION_REQUIRED
        })
        assert.deepEqual(state.elevated, [], 'nothing is elevated without consent')
      })
    }

    it('repairs ownership and retries once when elevation was granted', async () => {
      const target = path.join(workDir, 'rules.yaml')
      failWrites = [permissionError('EACCES')]

      await files.saveFileStrWithElevation('rules.yaml', 'repaired')

      assert.deepEqual(state.elevated, [
        {
          command: 'sh',
          args: ['-c', buildPermissionRepairCommand(target, process.getuid!(), process.getgid!())]
        }
      ])
      assert.deepEqual(writeAttempts, [target, target])
      assert.equal(readFileSync(target, 'utf8'), 'repaired')
    })

    it('does not elevate when the write succeeds', async () => {
      await files.saveFileStrWithElevation('rules.yaml', 'fine')

      assert.deepEqual(state.elevated, [])
      assert.deepEqual(writeAttempts, [path.join(workDir, 'rules.yaml')])
    })

    it('never elevates for files outside the managed directories', async () => {
      const outside = path.join(root, 'outside.txt')
      // 授权后的流程会重试一次（共 2 次写入），未授权只写 1 次。
      failWrites = [permissionError('EACCES'), permissionError('EACCES'), permissionError('EACCES')]

      await assert.rejects(files.saveFileStrWithElevation(outside, 'x'), { code: 'EACCES' })
      await assert.rejects(files.setFileStr(outside, 'x'), { code: 'EACCES' })

      assert.deepEqual(state.elevated, [])
    })

    it('never elevates on Windows', async () => {
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { value: 'win32' })
      failWrites = [permissionError('EACCES'), permissionError('EACCES')]

      try {
        await assert.rejects(files.saveFileStrWithElevation('rules.yaml', 'x'), { code: 'EACCES' })
      } finally {
        Object.defineProperty(process, 'platform', platform)
      }
      assert.deepEqual(state.elevated, [])
    })

    it('skips the repair when the process has no user id to hand the file back to', async () => {
      failWrites = [permissionError('EACCES')]
      const originalGetuid = process.getuid
      process.getuid = (() => undefined) as unknown as typeof process.getuid
      restorers.push(() => {
        process.getuid = originalGetuid
      })

      await files.saveFileStrWithElevation('rules.yaml', 'retried')

      assert.deepEqual(state.elevated, [])
      assert.equal(readFileSync(path.join(workDir, 'rules.yaml'), 'utf8'), 'retried')
    })
  })
})
