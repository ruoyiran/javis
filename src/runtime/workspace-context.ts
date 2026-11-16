import { realpathSync } from 'node:fs'
import { JavisError } from './error.js'

export function contextFromCwd(cwd: string = process.cwd()): string {
  return `cwd:${realpathSync.native(cwd)}`
}

export function normalizeWorktreeContext(worktree: string): string {
  if (typeof worktree !== 'string' || !worktree.trim()) {
    throw new JavisError('invalid_argument', 'worktree must be a non-empty string')
  }
  return `worktree:${worktree}`
}
