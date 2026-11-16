import { expect, test } from 'vitest'
import { parseDaemonRequest } from '../../src/runtime/daemon-request.js'

test('rejects malformed and unauthenticated requests before dispatch', () => {
  expect(() => parseDaemonRequest('null', 'secret')).toThrow(/invalid request/i)
  expect(() => parseDaemonRequest('{"id":1,"method":"getAppState","params":{},"token":"wrong"}', 'secret')).toThrow(/token/i)
  expect(() => parseDaemonRequest('{"id":1,"method":"getAppState","params":[],"token":"secret"}', 'secret')).toThrow(/parameters/i)
})

test('accepts a token-authenticated computer method with an object payload', () => {
  expect(parseDaemonRequest('{"id":3,"method":"listApps","params":{},"token":"secret"}', 'secret')).toEqual({
    id: 3, method: 'listApps', params: {}
  })
})
