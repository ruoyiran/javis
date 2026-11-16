import { expect, test } from 'vitest'
import { daemonEndpoint } from '../../src/runtime/daemon-endpoint.js'

test('uses a user-private runtime directory on each supported OS', () => {
  expect(daemonEndpoint('darwin', '/Users/alice', {}).directory).toBe('/Users/alice/Library/Application Support/Javis')
  expect(daemonEndpoint('linux', '/home/alice', { XDG_RUNTIME_DIR: '/run/user/1000' }).address).toBe('/run/user/1000/javis/daemon.sock')
  expect(daemonEndpoint('win32', 'C:\\Users\\Alice', { LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local' }).address).toMatch(/^\\\\\.\\pipe\\javis-[a-f0-9]{24}$/)
})

test('allows an absolute isolated state directory for an independent smoke session', () => {
  expect(daemonEndpoint('darwin', '/Users/alice', { JAVIS_STATE_DIR: '/tmp/javis-smoke' }).address).toBe('/tmp/javis-smoke/daemon.sock')
  expect(() => daemonEndpoint('darwin', '/Users/alice', { JAVIS_STATE_DIR: 'relative' })).toThrow(/absolute/i)
})
