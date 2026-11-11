import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeError } from './errorMessage'

describe('describeError', () => {
  it('reads the message of an Error', () => {
    assert.equal(describeError(new Error('boom')), 'boom')
  })

  it('reads the message of a controller rejection object', () => {
    assert.equal(
      describeError({ message: 'Selector update error: proxy not exist' }),
      'Selector update error: proxy not exist'
    )
  })

  it('stringifies everything else', () => {
    assert.equal(describeError('plain'), 'plain')
    assert.equal(describeError(42), '42')
    assert.equal(describeError(undefined), 'undefined')
    assert.equal(describeError({ code: 1 }), '[object Object]')
    assert.equal(describeError({ message: 7 }), '[object Object]')
  })
})
