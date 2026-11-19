import { create } from 'zustand'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
export type JavisContext = { id: string; root?: string; label?: string; owner: { kind: 'local' } | { kind: 'runtime'; environmentId: string } | { kind: 'ssh'; connectionId: string }; available?: boolean }
export const useJavisContexts = create<{ contexts: Record<string, JavisContext> }>(() => ({ contexts: {} }))
export function hydrateJavisContexts(contexts: JavisContext[]): void {
  const prior = useJavisContexts.getState().contexts
  useJavisContexts.setState({ contexts: { ...Object.fromEntries(Object.entries(prior).map(([id, row]) => [id, { ...row, available: false }])), ...Object.fromEntries(contexts.map((row) => [row.id, row])) } })
}
export function javisContext(id: string | null | undefined): JavisContext | undefined { return id ? useJavisContexts.getState().contexts[id] : undefined }
export function javisContextHost(id: string): ExecutionHostId | undefined {
  const row = javisContext(id)
  if (!row) return undefined
  if (row.available === false) throw new Error('The Javis context owner is unavailable')
  return row.owner.kind === 'local' ? 'local' : row.owner.kind === 'runtime' ? `runtime:${row.owner.environmentId}` : `ssh:${row.owner.connectionId}`
}
const views = new WeakMap<JavisContext, Worktree>()
export function javisContextWorkspace(id: string, expectedHost?: ExecutionHostId): Worktree | undefined {
  const row = javisContext(id)
  if (!row || row.available === false || (expectedHost && expectedHost!==javisContextHost(id))) return undefined
  const existing = views.get(row); if (existing) return existing
  const view = { id, path: row.root ?? '', displayName: row.label ?? id, branch: '', head: '', repoId: '', hostId: javisContextHost(id) } as Worktree
  views.set(row, view); return view
}
