import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import {
  activateUserOwnedMihomoApiSocketFallback,
  readMihomoApiSocketOverride,
  setMihomoApiSocketOverridePathsForTests,
} from './mihomoApiSocketOverrideCore'

describe('mihomoApiSocketOverrideCore', () => {
  it('activates user-owned fallback socket override', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparkle-socket-override-'))
    const overridePath = path.join(dir, 'override')
    const fallbackPath = path.join(dir, 'run', 'mihomo-api.sock')
    setMihomoApiSocketOverridePathsForTests({
      overridePath,
      fallbackSocketPath: fallbackPath,
    })
    const activated = activateUserOwnedMihomoApiSocketFallback()
    assert.equal(activated, fallbackPath)
    assert.equal(readMihomoApiSocketOverride(), fallbackPath)
    setMihomoApiSocketOverridePathsForTests({ overridePath: null, fallbackSocketPath: null })
  })
})
