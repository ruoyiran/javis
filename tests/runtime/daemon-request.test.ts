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

test.each([
  { method: 'getAppState', params: { app: 'Fixture' }, timeoutMs: 120001 },
  { method: 'getAppState', params: { app: 'Fixture', restoreWindow: true }, timeoutMs: 120000 },
  { method: 'click', params: { app: 'Fixture' }, timeoutMs: 120000 },
  { method: 'launchApp', params: { app: 'Fixture' }, timeoutMs: 120000 },
  { method: 'permissionsOpen', params: {}, timeoutMs: 120000 }
])('rejects an envelope that would extend passive bounds or input delivery: %j', request => {
  expect(() => parseDaemonRequest(JSON.stringify({ id: 1, token: 'secret', ...request }), 'secret')).toThrow()
})
