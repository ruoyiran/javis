import { expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ local: vi.fn(), remote: vi.fn() }))
vi.mock('../../src/runtime/public.js', () => ({ callJavis: calls.local }))
vi.mock('../../src/runtime/remote-stdio.js', () => ({ callRemoteJavis: calls.remote }))

import { callTarget } from '../../src/runtime/target-router.js'

it('routes a worktree context to the local daemon unless a host is explicitly selected', async () => {
  calls.local.mockResolvedValueOnce({ source: 'local' })
  const result = await callTarget('getAppState', { app: 'Finder' }, { context: 'worktree:repo-a' })
  expect(result).toEqual({ source: 'local' })
  expect(calls.local).toHaveBeenCalledWith('getAppState', { app: 'Finder', worktree: 'worktree:repo-a' })
  expect(calls.remote).not.toHaveBeenCalled()
})

it('routes an explicitly selected host while preserving the independent context', async () => {
  calls.remote.mockResolvedValueOnce({ source: 'remote' })
  const result = await callTarget('getAppState', { app: 'Finder' }, { host: 'devbox', context: 'cwd:/folder' })
  expect(result).toEqual({ source: 'remote' })
  expect(calls.remote).toHaveBeenCalledWith('getAppState', { app: 'Finder', worktree: 'cwd:/folder' }, 'devbox')
})
