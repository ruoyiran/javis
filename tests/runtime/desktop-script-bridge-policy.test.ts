import { beforeEach, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'

import { execBridge } from '../../src/runtime/desktop-script-provider/bridge.js'

const childProcess = { execFile: vi.fn() }
const processRunner = childProcess.execFile as unknown as typeof execFile

beforeEach(() => { childProcess.execFile.mockReset() })

it('does not replay a Windows action after an ambiguous policy-looking process failure', async () => {
  childProcess.execFile.mockImplementation((...args: unknown[]) => {
    if (typeof args[3] !== 'function') throw new Error(`unexpected execFile arguments: ${args.length}`)
    const callback = args[3] as (error: Error, stdout: string, stderr: string) => void
    queueMicrotask(() => callback(new Error('process failed'), '', 'UnauthorizedAccess'))
    return { kill: () => true }
  })

  await expect(execBridge('win32', 'fixture.ps1', 'operation.json', 30_000, {
    request: { tool: 'click', app: 'Demo', x: 1, y: 2 },
    execFile: processRunner
  })).rejects.toMatchObject({ code: 'accessibility_error' })
  expect(childProcess.execFile).toHaveBeenCalledTimes(1)
})

it('does not retry a snapshot that may have restored a window', async () => {
  childProcess.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args[3] as (error: Error, stdout: string, stderr: string) => void
    queueMicrotask(() => callback(new Error('process failed'), '', 'UnauthorizedAccess'))
    return { kill: () => true }
  })

  await expect(execBridge('win32', 'fixture.ps1', 'operation.json', 30_000, {
    request: { tool: 'get_app_state', app: 'Demo', restoreWindow: true },
    execFile: processRunner
  })).rejects.toMatchObject({ code: 'accessibility_error' })
  expect(childProcess.execFile).toHaveBeenCalledTimes(1)
})

it('retries a read-only Windows operation after a policy-blocked start', async () => {
  childProcess.execFile.mockImplementation((...args: unknown[]) => {
    if (typeof args[3] !== 'function') throw new Error(`unexpected execFile arguments: ${args.length}`)
    const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void
    const attempt = childProcess.execFile.mock.calls.length
    queueMicrotask(() => {
      if (attempt === 1) callback(new Error('process failed'), '', 'UnauthorizedAccess')
      else callback(null, '{"ok":true}', '')
    })
    return { kill: () => true }
  })

  const result = await execBridge('win32', 'fixture.ps1', 'operation.json', 30_000, {
    request: { tool: 'handshake' },
    execFile: processRunner
  })
  expect(result.stdout).toBe('{"ok":true}')
  expect(childProcess.execFile).toHaveBeenCalledTimes(2)
})
