import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeMacOs26MitigationPatch,
  darwinMajorFromRelease,
  isMacOs26OrNewer,
  shouldForceDisableGpu,
} from './macos26ElectronMitigationCore'

describe('macos26ElectronMitigationCore', () => {
  it('detects macOS 26 via Darwin 25', () => {
    assert.equal(darwinMajorFromRelease('25.5.0'), 25)
    assert.equal(isMacOs26OrNewer('darwin', '25.5.0'), true)
    assert.equal(isMacOs26OrNewer('darwin', '24.6.0'), false)
  })

  it('patches disableGPU and service mode on macOS 26', () => {
    const patch = computeMacOs26MitigationPatch({
      platform: 'darwin',
      release: '25.5.0',
      disableGPU: false,
      corePermissionMode: 'elevated',
      sparkleServiceBinaryExists: true,
    })
    assert.deepEqual(patch, { disableGPU: true, corePermissionMode: 'service' })
  })

  it('forces disableGPU even when config false on macOS 26', () => {
    assert.equal(shouldForceDisableGpu('darwin', '25.5.0', false), true)
    assert.equal(shouldForceDisableGpu('darwin', '24.6.0', false), false)
  })
})
