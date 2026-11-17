import { expect, test, vi } from 'vitest'

import { runCli } from '../../src/cli/run-cli.js'

const resetResult = { platform: 'darwin', permissions: [
  { id: 'accessibility', status: 'not-granted' },
  { id: 'screenshots', status: 'not-granted' }
] }

test('renders checked setup without claiming a helper was opened', async () => {
  const lines: string[] = []
  const result = { platform: 'darwin', helperAppPath: '/test/Javis.app', openedSettings: false, launchedHelper: false, permissions: [{ id: 'accessibility', status: 'granted' }, { id: 'screenshots', status: 'granted' }], nextStep: null }
  expect(await runCli(['computer', 'permissions'], { permissionCall: async () => result, stdout: line => lines.push(line), stderr: () => {} })).toBe(0)
  expect(lines[0]).toContain('Javis permissions checked.')
  expect(lines[0]).toContain('accessibility=granted, screenshots=granted')
  expect(lines[0]).not.toContain('Opened')
})

test('renders a superseded permission launch as replaced', async () => {
  const lines: string[] = []
  const result = { platform: 'darwin', helperAppPath: '/test/Javis.app', openedSettings: false, launchedHelper: false, launchSuperseded: true, permissions: [], nextStep: 'Use the newer request.' }
  expect(await runCli(['computer', 'permissions'], { permissionCall: async () => result, stdout: line => lines.push(line), stderr: () => {} })).toBe(0)
  expect(lines[0]).toContain('replaced by a newer request')
  expect(lines[0]).not.toContain('Opened')
})

test('renders unsupported and queued setup truthfully', async () => {
  const lines: string[] = []
  const unsupported = { platform: 'linux', helperAppPath: null, openedSettings: false, launchedHelper: false, permissions: [], nextStep: 'Use the active graphical login.' }
  expect(await runCli(['computer', 'permissions'], { permissionCall: async () => unsupported, stdout: line => lines.push(line), stderr: () => {} })).toBe(0)
  expect(lines[0]).toContain('macOS')
  expect(lines[0]).toContain('Use the active graphical login.')
  lines.length = 0
  const queued = { platform: 'darwin', helperAppPath: '/test/Javis.app', openedSettings: false, launchedHelper: false, launchQueued: true, permissions: [], nextStep: 'Wait for setup.' }
  expect(await runCli(['--json=false', 'computer', 'permissions', '--id=accessibility'], { permissionCall: async () => queued, stdout: line => lines.push(line), stderr: () => {} })).toBe(0)
  expect(JSON.parse(lines[0])).toEqual({ ok: true, result: queued })
  lines.length = 0
  expect(await runCli(['computer', 'permissions'], { permissionCall: async () => queued, stdout: line => lines.push(line), stderr: () => {} })).toBe(0)
  expect(lines[0]).toContain('Queued Javis permission setup')
  expect(lines[0]).not.toContain('Opened')
})

test('accepts the computer permissions setup alias with an explicit permission', async () => {
  const lines: string[] = []
  const permissionCall = vi.fn(async () => ({ openedSettings: true }))
  const status = await runCli(['computer', 'permissions', '--id', 'screenshots', '--json'], { permissionCall, stdout: line => lines.push(line), stderr: () => {} })
  expect(status).toBe(0)
  expect(permissionCall).toHaveBeenCalledWith('permissionsOpen', { id: 'screenshots' })
  expect(JSON.parse(lines[0])).toEqual({ ok: true, result: { openedSettings: true } })
})

test('retains status and reset subcommands under computer permissions', async () => {
  const permissionCall = vi.fn(async () => resetResult)
  for (const command of ['status', 'reset']) {
    expect(await runCli(['computer', 'permissions', command, '--json'], { permissionCall, stdout: () => {}, stderr: () => {} })).toBe(0)
  }
  expect(permissionCall.mock.calls).toEqual([['permissionsStatus', {}], ['permissionsReset', {}]])
})

test('rejects a remote permission setup alias without opening local setup', async () => {
  const lines: string[] = []
  const permissionCall = vi.fn(async () => ({}))
  expect(await runCli(['computer', 'permissions', '--host', 'devbox', '--json'], { permissionCall, stdout: line => lines.push(line), stderr: () => {} })).toBe(1)
  expect(permissionCall).not.toHaveBeenCalled()
  expect(JSON.parse(lines[0])).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
})

test('reports the permission state returned after reset', async () => {
  const lines: string[] = []
  const permissionCall = vi.fn(async () => resetResult)
  const status = await runCli(['permissions', 'reset', '--json'], { permissionCall, stdout: line => lines.push(line), stderr: () => {} })
  expect(status).toBe(0)
  expect(permissionCall).toHaveBeenCalledWith('permissionsReset', {})
  expect(JSON.parse(lines[0])).toEqual({ ok: true, result: resetResult })
})

test('does not reset grants when an unknown option or argument is present', async () => {
  const permissionCall = vi.fn(async () => resetResult)
  const lines: string[] = []
  const status = await runCli(['permissions', 'reset', '--dry-run'], { permissionCall, stdout: () => {}, stderr: line => lines.push(line) })
  expect(status).toBe(1)
  expect(permissionCall).not.toHaveBeenCalled()
  expect(lines[0]).toMatch(/unknown|usage|invalid/i)
})

test('reads permission status on the selected SSH host', async () => {
  const lines: string[] = []
  const remotePermissionsStatus = vi.fn(async () => ({ platform: 'darwin', permissions: [{ id: 'accessibility', status: 'granted' }] }))
  const status = await runCli(['permissions', 'status', '--host', 'devbox', '--json'], {
    remotePermissionsStatus,
    stdout: line => lines.push(line), stderr: () => {}
  })
  expect(status).toBe(0)
  expect(remotePermissionsStatus).toHaveBeenCalledWith('devbox')
  expect(JSON.parse(lines[0])).toEqual({ ok: true, result: { platform: 'darwin', permissions: [{ id: 'accessibility', status: 'granted' }] } })
})
