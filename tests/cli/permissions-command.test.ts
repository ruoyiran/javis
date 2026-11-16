import { expect, test, vi } from 'vitest'

import { runCli } from '../../src/cli/run-cli.js'

const resetResult = { platform: 'darwin', permissions: [
  { id: 'accessibility', status: 'not-granted' },
  { id: 'screenshots', status: 'not-granted' }
] }

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
