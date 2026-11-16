import { expect, test, vi } from 'vitest'

const providers = vi.hoisted(() => ({ mac: vi.fn(), desktop: vi.fn() }))
vi.mock('../../src/runtime/macos-provider.js', () => ({ createMacOSProvider: providers.mac }))
vi.mock('../../src/runtime/desktop-script-provider/client.js', () => ({ createDesktopScriptProvider: providers.desktop }))
import { createProviderForPlatform } from '../../src/runtime/provider-selection.js'

test('routes each supported platform to its own provider', () => {
  const mac = { call: vi.fn(), shutdown: vi.fn() }
  const linux = { call: vi.fn(), shutdown: vi.fn() }
  const windows = { call: vi.fn(), shutdown: vi.fn() }
  providers.mac.mockReturnValue(mac)
  providers.desktop.mockReturnValueOnce(linux).mockReturnValueOnce(windows)
  expect(createProviderForPlatform('darwin')).toBe(mac)
  expect(createProviderForPlatform('linux')).toBe(linux)
  expect(createProviderForPlatform('win32')).toBe(windows)
  expect(providers.desktop.mock.calls.map(call => call[0])).toEqual(['linux', 'win32'])
})

test('rejects an OS without a Javis desktop provider', () => {
  expect(() => createProviderForPlatform('freebsd')).toThrow(/unsupported/i)
})

test('passes the daemon delivery gate to Linux and Windows providers', () => {
  const canDeliver = () => false
  createProviderForPlatform('linux', { canDeliver })
  createProviderForPlatform('win32', { canDeliver })
  expect(providers.desktop.mock.calls.slice(-2)).toEqual([
    ['linux', { canDeliver }],
    ['win32', { canDeliver }]
  ])
})
