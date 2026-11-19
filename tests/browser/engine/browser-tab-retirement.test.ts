import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ ipcMain: { on: vi.fn(), removeListener: vi.fn() } }))
vi.mock('../../../src/browser/source/main/browser/guest-lifecycle/manager/browser-manager', () => ({ browserManager: { closePopupPage: async () => false, getWorktreeIdForTab: () => undefined } }))
import { BrowserWorkspaceSessions } from '../../../src/browser/main/workspace-sessions'
import { ServeBrowserTabs } from '../../../src/browser/source/main/runtime/browser/headless/serve-browser-tabs'
import { RuntimeBrowserTabClose } from '../../../src/browser/source/main/runtime/browser/tabs/browser-tab-close'
import { RuntimeBrowserPageRegistry } from '../../../src/browser/source/main/runtime/browser/client-pages/runtime-browser-page-registry'
import type { RuntimeBrowserCommandHost } from '../../../src/browser/source/main/runtime/browser/commands/browser-command-contracts'
import type { RuntimeBrowserCommandTargets } from '../../../src/browser/source/main/runtime/browser/commands/browser-command-targets'
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
for (const live of [true, false]) it(`retires a page-pinned ${live ? 'live' : 'saved'} tab in its owning context`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'javis-page-retirement-')); directories.push(directory)
  const sessions = new BrowserWorkspaceSessions(directory)
  const pages = new RuntimeBrowserPageRegistry()
  const registered = new Map(live ? [['page-a', 1]] : [])
  const backend = { createTab: async () => ({ browserPageId: 'page-a' }), closeTab: async (page: string) => { registered.delete(page) }, ownsTab: (page: string) => registered.has(page) }
  const saved = new ServeBrowserTabs({ backend: context => context === 'B' ? null : backend, livePageIds: () => new Set(registered.keys()), savedWorktreeIds: () => sessions.contexts(), session: id => sessions.session(id), hostId: () => 'local', save: (id, session) => sessions.save(id, session) })
  saved.opened({ worktreeId: 'A', pageId: 'page-a', url: 'https://fixture.example/', title: 'Fixture' })
  sessions.select('B')
  const host = {
    getRuntimeBrowserPageRegistry: () => pages,
    getAgentBrowserBridge: () => ({ getRegisteredTabs: () => registered, getActivePageId: () => 'page-a', getActiveWebContentsId: () => 1 }),
    getBrowserPageWorkspaceId: (page: string) => sessions.owner(page),
    getAvailableAuthoritativeWindow: () => ({}),
    getOffscreenBrowserBackend: () => backend,
    isBrowserWorkspaceRendered: (context: string) => context === 'B',
    retireRuntimeOwnedBrowserSessionTab: (context: string, page: string) => saved.closed(context, page)
  }
  const targets = { retireGhostBrowserSessionRow: (context: string | undefined, page: string) => context !== undefined && saved.closed(context, page) }
  const close = new RuntimeBrowserTabClose({} as never, host as unknown as RuntimeBrowserCommandHost, targets as unknown as RuntimeBrowserCommandTargets)
  expect(await close.browserTabClose({ page: 'page-a' })).toEqual({ closed: true })
  expect(new BrowserWorkspaceSessions(directory).session('A').browserTabsByWorktree?.A).toEqual([])
})
