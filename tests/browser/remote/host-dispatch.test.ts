import { expect, test } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatchBrowserHostRequest } from '../../../src/browser/remote/host-dispatch.js'

test('document authority reads the entry and explicitly granted assets while rejecting sibling and symlink escape', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'javis-host-fixture-'))
  const worktree = join(directory, 'workspace')
  await mkdir(worktree); await mkdir(join(worktree, 'assets'))
  await writeFile(join(worktree, 'index.html'), '<h1>Fixture</h1>')
  await writeFile(join(worktree, 'private.txt'), 'private')
  await writeFile(join(directory, 'outside.txt'), 'outside')
  await symlink(join(directory, 'outside.txt'), join(worktree, 'assets', 'escape'))
  const params = { worktree: `cwd:${worktree}`, entryRelativePath: 'index.html', implicitRootRelativePath: null, authorizedRootRelativePaths: [] }
  try {
    await expect(dispatchBrowserHostRequest({ target: 'local', method: 'files.readDocPreview', params: { ...params, relativePath: 'index.html' } })).resolves.toEqual({ ok: true, result: { content: '<h1>Fixture</h1>', isBinary: false } })
    expect(await dispatchBrowserHostRequest({ target: 'local', method: 'files.readDocPreview', params: { ...params, relativePath: 'private.txt' } })).toMatchObject({ ok: false, error: { message: 'doc_preview_path_unauthorized' } })
    expect(await dispatchBrowserHostRequest({ target: 'local', method: 'files.readDocPreview', params: { ...params, relativePath: 'assets/escape', authorizedRootRelativePaths: ['assets'] } })).toMatchObject({ ok: false, error: { message: 'doc_preview_path_unauthorized' } })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
