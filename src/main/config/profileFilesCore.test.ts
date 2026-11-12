import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  buildPermissionRepairCommand,
  FILE_PERMISSION_ELEVATION_REQUIRED,
  isManagedPath,
  isPermissionError,
  resolveEditablePath,
  writeWithPermissionRecovery
} from './profileFilesCore'

function errorWithCode(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('resolveEditablePath', () => {
  it('uses absolute paths as they are', () => {
    assert.equal(resolveEditablePath('/etc/hosts', '/work'), '/etc/hosts')
    assert.equal(resolveEditablePath('C:\\data\\a.yaml', '/work'), 'C:\\data\\a.yaml')
  })

  it('places relative paths inside the base directory', () => {
    assert.equal(resolveEditablePath('profiles/a.yaml', '/work'), '/work/profiles/a.yaml')
    assert.equal(resolveEditablePath('a.yaml', '/work/'), '/work/a.yaml')
  })
})

describe('isManagedPath', () => {
  const roots = ['/data/work', '/data/profiles/p1']

  it('accepts the roots themselves and anything below them', () => {
    assert.equal(isManagedPath('/data/work', roots), true)
    assert.equal(isManagedPath('/data/work/ruleset/a.txt', roots), true)
    assert.equal(isManagedPath('/data/profiles/p1/x/../y.yaml', roots), true)
  })

  it('rejects siblings that merely share a prefix, parents and traversals out of a root', () => {
    assert.equal(isManagedPath('/data/work2/a.txt', roots), false)
    assert.equal(isManagedPath('/data', roots), false)
    assert.equal(isManagedPath('/data/work/../secrets/a.txt', roots), false)
    assert.equal(isManagedPath('/etc/passwd', roots), false)
  })

  it('manages nothing without roots', () => {
    assert.equal(isManagedPath('/data/work/a.txt', []), false)
  })
})

describe('isPermissionError', () => {
  it('recognises access and permission errors by code', () => {
    assert.equal(isPermissionError(errorWithCode('EACCES')), true)
    assert.equal(isPermissionError(errorWithCode('EPERM')), true)
  })

  it('rejects other errors and non-error values', () => {
    assert.equal(isPermissionError(errorWithCode('ENOENT')), false)
    assert.equal(isPermissionError(new Error('plain')), false)
    for (const value of [null, undefined, 'EACCES', 13]) {
      assert.equal(isPermissionError(value), false)
    }
  })
})

describe('buildPermissionRepairCommand', () => {
  it('repairs the file and its parent directory for the given owner', () => {
    assert.equal(
      buildPermissionRepairCommand('/data/work/a.yaml', 501, 20),
      [
        `t='/data/work/a.yaml'`,
        `p='/data/work'`,
        `mkdir -p "$p"`,
        `chown 501:20 "$p"`,
        `chmod u+rwx "$p"`,
        `[ ! -e "$t" ] || { chown 501:20 "$t" && chmod u+rw "$t"; }`
      ].join('; ')
    )
  })

  it('keeps hostile file names inert when a real shell runs the command', (t) => {
    if (process.platform === 'win32') {
      t.skip('POSIX shell only')
      return
    }
    const sandbox = mkdtempSync(join(tmpdir(), 'sparkle-repair-'))
    try {
      // 命令在 sandbox 里执行：若注入生效，`touch canary` 会在 sandbox 里留下 canary。
      const canary = join(sandbox, 'canary')
      const parent = join(sandbox, `it's a "dir" $(touch canary) ;touch canary;`)
      mkdirSync(parent)
      const target = join(parent, `x'y $(touch canary).yaml`)
      writeFileSync(target, 'data')

      const uid = process.getuid?.() ?? 0
      const gid = process.getgid?.() ?? 0
      execFileSync('sh', ['-c', buildPermissionRepairCommand(target, uid, gid)], { cwd: sandbox })

      assert.equal(existsSync(canary), false)
      assert.equal(statSync(target).uid, uid)
      assert.equal((statSync(target).mode & 0o600) === 0o600, true)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('creates a missing parent directory but leaves a missing file alone', (t) => {
    if (process.platform === 'win32') {
      t.skip('POSIX shell only')
      return
    }
    const sandbox = mkdtempSync(join(tmpdir(), 'sparkle-repair-'))
    try {
      const target = join(sandbox, 'missing-dir', 'new.yaml')

      execFileSync('sh', [
        '-c',
        buildPermissionRepairCommand(target, process.getuid?.() ?? 0, process.getgid?.() ?? 0)
      ])

      assert.equal(existsSync(join(sandbox, 'missing-dir')), true)
      assert.equal(existsSync(target), false)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

describe('writeWithPermissionRecovery', () => {
  function createRig(options: { failures?: Error[]; canElevate?: boolean } = {}) {
    const events: string[] = []
    const failures = [...(options.failures ?? [])]
    return {
      events,
      deps: {
        write: async () => {
          events.push('write')
          const failure = failures.shift()
          if (failure) {
            throw failure
          }
        },
        repair: async () => {
          events.push('repair')
        },
        canElevate: options.canElevate ?? true
      }
    }
  }

  it('writes once when nothing goes wrong', async () => {
    const rig = createRig()

    await writeWithPermissionRecovery(rig.deps, false)
    await writeWithPermissionRecovery(rig.deps, true)

    assert.deepEqual(rig.events, ['write', 'write'])
  })

  it('rethrows errors that are not about permissions without repairing', async () => {
    const rig = createRig({ failures: [errorWithCode('ENOSPC')] })

    await assert.rejects(writeWithPermissionRecovery(rig.deps, true), /ENOSPC/)
    assert.deepEqual(rig.events, ['write'])
  })

  it('asks for elevation when a managed file cannot be written and elevation was not granted', async () => {
    const rig = createRig({ failures: [errorWithCode('EACCES')] })

    await assert.rejects(
      writeWithPermissionRecovery(rig.deps, false),
      new Error(FILE_PERMISSION_ELEVATION_REQUIRED)
    )
    assert.deepEqual(rig.events, ['write'])
  })

  it('rethrows the permission error itself when elevation cannot help', async () => {
    const rig = createRig({ failures: [errorWithCode('EPERM')], canElevate: false })

    await assert.rejects(writeWithPermissionRecovery(rig.deps, false), /EPERM/)
    assert.deepEqual(rig.events, ['write'])
  })

  it('repairs first and then retries the write once the user granted elevation', async () => {
    const rig = createRig({ failures: [errorWithCode('EACCES')] })

    await writeWithPermissionRecovery(rig.deps, true)

    assert.deepEqual(rig.events, ['write', 'repair', 'write'])
  })

  it('reports the retry failure when the repair did not help', async () => {
    const rig = createRig({ failures: [errorWithCode('EACCES'), errorWithCode('EACCES')] })

    await assert.rejects(writeWithPermissionRecovery(rig.deps, true), /EACCES/)
    assert.deepEqual(rig.events, ['write', 'repair', 'write'])
  })
})
