import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserWorkspaceSessions } from '../../../src/browser/main/workspace-sessions'
import { getDefaultWorkspaceSession } from '../../../src/browser/source/shared/constants'
import { ServeBrowserTabs } from '../../../src/browser/source/main/runtime/browser/headless/serve-browser-tabs'
const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
function directory() { const path = mkdtempSync(join(tmpdir(), 'javis-browser-sessions-')); directories.push(path); return path }
describe('browser workspace persistence', () => {
  it('binds pending writes to their context and rejects a replaced generation', () => {
    const sessions = new BrowserWorkspaceSessions(directory())
    sessions.select('id:A')
    const generation = sessions.generation
    sessions.select('id:B')
    sessions.replace({ context: 'A', generation, session: { ...getDefaultWorkspaceSession(), activeWorktreeId: 'A' } })
    expect(sessions.session('B').activeWorktreeId).toBeNull()
    expect(sessions.session('A').activeWorktreeId).toBe('A')
    sessions.select('id:A')
    expect(() => sessions.replace({ context: 'A', generation, session: getDefaultWorkspaceSession() })).toThrow('browser_workspace_revision_stale')
    expect(sessions.context).toBe('A')
  })
  it('retains a canonical page after restart and restores it only on first use', async () => {
    const path = directory()
    const first = new BrowserWorkspaceSessions(path)
    const backend = { createTab: async () => { throw new Error('Unexpected navigation before page use') }, ownsTab: () => false, closeTab: async () => {} }
    const open = new ServeBrowserTabs({ backend: () => backend, livePageIds: () => new Set(), savedWorktreeIds: () => first.contexts(), session: id => first.session(id), hostId: () => 'local', save: (id, session) => first.save(id, session) })
    open.opened({ worktreeId: 'A', pageId: 'page-a', url: 'https://fixture.example/', title: 'Fixture', profileId: 'profile-a' })
    const restarted = new BrowserWorkspaceSessions(path)
    let navigation: unknown
    const restore = new ServeBrowserTabs({ backend: () => ({ ...backend, createTab: async params => { navigation = params; return { browserPageId: params.browserPageId! } } }), livePageIds: () => new Set(), savedWorktreeIds: () => restarted.contexts(), session: id => restarted.session(id), hostId: () => 'local', save: (id, session) => restarted.save(id, session) })
    expect(navigation).toBeUndefined()
    expect(restore.listUnstarted('A')).toMatchObject([{ browserPageId: 'page-a', url: 'https://fixture.example/', profileId: 'profile-a', worktreeId: 'A' }])
    expect(await restore.start('A', 'page-a')).toBe(true)
    expect(navigation).toEqual({ browserPageId: 'page-a', url: 'https://fixture.example/', worktreeId: 'A', profileId: 'profile-a' })
  })
})
it('preserves the floating browser workspace across context switches', () => {
  const path = directory()
  const sessions = new BrowserWorkspaceSessions(path)
  const layout = new ServeBrowserTabs({ backend: () => ({ createTab: async () => ({ browserPageId: 'floating-page' }), closeTab: async () => {}, ownsTab: () => false }), livePageIds: () => new Set(), savedWorktreeIds: () => sessions.contexts(), session: id => sessions.session(id), hostId: () => 'local', save: (id, session) => sessions.save(id, session) })
  layout.opened({ worktreeId: 'global-floating-terminal', pageId: 'floating-page', url: 'https://floating.example/', title: 'Floating' })
  sessions.select('id:B')
  expect(sessions.session('B').browserTabsByWorktree?.['global-floating-terminal']).toMatchObject([{ id: 'floating-page', url: 'https://floating.example/' }])
  const restarted = new BrowserWorkspaceSessions(path)
  expect(restarted.session('B').browserPagesByWorkspace?.['floating-page']).toMatchObject([{ id: 'floating-page', url: 'https://floating.example/' }])
})
