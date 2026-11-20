import { expect, it } from 'vitest'
import {
  hydrateWorkspaceSession,
  serializeWorkspaceSession
} from '../../../src/browser/renderer/workspace-session-state'
import { getDefaultWorkspaceSession } from '../../../src/browser/source/shared/constants'
import type { AppState } from '../../../src/browser/source/renderer/src/store/types'

const base = {
  activeWorktreeId: 'context-a',
  activeTabType: 'browser',
  activeTabTypeByWorktree: {},
  openFiles: [],
  tabsByWorktree: {},
  activeTabIdByWorktree: {},
  activeFileIdByWorktree: {},
  editorDrafts: {}
} as unknown as AppState

it('preserves unsaved drafts when context restoration fails, a browser checkpoint runs and the host restarts', () => {
  const input = {
    ...getDefaultWorkspaceSession(),
    openFilesByWorktree: {
      'removed-folder': [
        {
          filePath: '/tmp/removed/notes.txt',
          relativePath: 'notes.txt',
          worktreeId: 'removed-folder',
          language: 'plaintext',
          dirtyDraftContent: 'unsaved local text',
          lastKnownDiskSignature: 'local-baseline'
        }
      ],
      'offline-context': [
        {
          filePath: '/srv/offline/notes.txt',
          relativePath: 'notes.txt',
          worktreeId: 'offline-context',
          language: 'plaintext',
          runtimeEnvironmentId: 'host-b',
          dirtyDraftContent: 'unsaved remote text',
          lastKnownDiskSignature: 'remote-baseline'
        }
      ]
    }
  }
  const unavailable = hydrateWorkspaceSession(base, input, 'context-a', new Set(['context-a']))
  const checkpoint = serializeWorkspaceSession(
    {
      ...base,
      ...unavailable,
      browserUrlHistory: [
        {
          url: 'https://example.test/after-restore',
          normalizedUrl: 'https://example.test/after-restore',
          title: 'After restore',
          visitCount: 1,
          lastVisitedAt: 1
        }
      ]
    } as AppState,
    input
  )
  expect(checkpoint.openFilesByWorktree?.['removed-folder']).toEqual([
    {
      filePath: '/tmp/removed/notes.txt',
      relativePath: 'notes.txt',
      worktreeId: 'removed-folder',
      language: 'plaintext',
      dirtyDraftContent: 'unsaved local text',
      lastKnownDiskSignature: 'local-baseline'
    }
  ])
  expect(checkpoint.openFilesByWorktree?.['offline-context']).toEqual([
    {
      filePath: '/srv/offline/notes.txt',
      relativePath: 'notes.txt',
      worktreeId: 'offline-context',
      language: 'plaintext',
      runtimeEnvironmentId: 'host-b',
      dirtyDraftContent: 'unsaved remote text',
      lastKnownDiskSignature: 'remote-baseline'
    }
  ])
  const restarted = hydrateWorkspaceSession(
    base,
    JSON.parse(JSON.stringify(checkpoint)),
    'context-a',
    new Set(['context-a', 'removed-folder', 'offline-context'])
  )
  const local = restarted.openFiles?.find((file) => file.worktreeId === 'removed-folder')
  const remote = restarted.openFiles?.find((file) => file.worktreeId === 'offline-context')
  expect(restarted.editorDrafts?.[local!.id]).toBe('unsaved local text')
  expect(local?.lastKnownDiskSignature).toBe('local-baseline')
  expect(restarted.editorDrafts?.[remote!.id]).toBe('unsaved remote text')
  expect(remote?.lastKnownDiskSignature).toBe('remote-baseline')
})
