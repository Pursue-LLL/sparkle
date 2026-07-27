import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatUnknownErrorForUi } from './format-unknown-error'

describe('formatUnknownErrorForUi', () => {
  it('unwraps mihomo plain object message', () => {
    assert.equal(
      formatUnknownErrorForUi({ message: 'timeout: no recent network activity' }),
      'timeout: no recent network activity',
    )
  })

  it('never returns [object Object]', () => {
    assert.notEqual(formatUnknownErrorForUi({ foo: 'bar' }), '[object Object]')
  })
})
