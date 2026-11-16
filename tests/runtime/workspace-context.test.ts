import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { contextFromCwd, normalizeWorktreeContext } from '../../src/runtime/workspace-context.js'

it('uses the canonical directory as a stable context even outside a Git checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'javis-folder-'))
  const link = `${directory}-link`
  try {
    await symlink(directory, link, process.platform === 'win32' ? 'junction' : 'dir')
    const canonical = await realpath(directory)
    expect(contextFromCwd(link)).toBe(`cwd:${canonical}`)
    expect(contextFromCwd(directory)).toBe(`cwd:${canonical}`)
  } finally {
    await rm(link, { force: true })
    await rm(directory, { recursive: true, force: true })
  }
})

it('keeps explicit worktree IDs opaque and separate from directory contexts', () => {
  expect(normalizeWorktreeContext('feature/fix-é')).toBe('worktree:feature/fix-é')
  expect(() => normalizeWorktreeContext('  ')).toThrow()
})
