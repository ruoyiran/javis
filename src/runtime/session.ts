import { randomUUID } from 'node:crypto'
import { JavisError } from './error.js'
import { validateComputerProviderActionParams } from './computer-provider-action-validation.js'
import { ComputerTreeBaselines } from './computer-snapshot-tree-diff.js'
import { normalizeComputerActionResult, rejectContradictedComputerAction } from './computer-action-verification-normalization.js'
import type { JavisProvider } from './provider.js'
import type { ComputerActionResult, ComputerSnapshotResult, ComputerProviderCapabilities } from '../contract/computer-use-runtime-types.js'
export type JavisMethod = 'capabilities' | 'listApps' | 'listWindows' | 'getAppState' | 'click' | 'performSecondaryAction' | 'scroll' | 'drag' | 'typeText' | 'pressKey' | 'hotkey' | 'pasteText' | 'setValue'
type SessionTarget = { observedAt: number; app: string; windowId?: number | null; windowIndex?: number | null }
export class SessionRuntime {
  private sessions = new Map<string, SessionTarget>()
  private baselines = new ComputerTreeBaselines()
  constructor(private native: JavisProvider | ((method: string, params: Record<string, unknown>) => Promise<unknown>)) {}
  async call(method: JavisMethod, params: Record<string, unknown>): Promise<unknown> {
    if (!['capabilities','listApps','listWindows','getAppState','click','performSecondaryAction','scroll','drag','typeText','pressKey','hotkey','pasteText','setValue'].includes(method)) throw new JavisError('invalid_argument','Unknown method')
    const action = !['capabilities','listApps','listWindows','getAppState'].includes(method)
    let sessionId = params.sessionId
    const worktree=params.worktree
    if (worktree !== undefined) {
      if (typeof worktree !== 'string' || !worktree) throw new JavisError('invalid_argument','worktree must be a non-empty string')
      if (sessionId !== undefined) throw new JavisError('invalid_argument','sessionId and worktree are mutually exclusive')
      sessionId=`worktree:${worktree}`
    }
    if (action || method === 'getAppState') {
      if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId)) throw new JavisError('invalid_argument','sessionId must be a non-empty string')
      if (action && typeof sessionId !== 'string') throw new JavisError('invalid_argument','Actions require sessionId from getAppState')
      const observed=action ? this.sessions.get(sessionId as string) : undefined
      if (action && (!observed || Date.now() - observed.observedAt > 120_000)) throw new JavisError('stale_snapshot','Refresh getAppState before acting')
      if (action && observed && (params.app !== observed.app ||
        (params.windowId !== undefined && params.windowId !== observed.windowId) ||
        (params.windowIndex !== undefined && params.windowIndex !== observed.windowIndex))) {
        throw new JavisError('stale_snapshot','Action target differs from the observed app or window')
      }
      sessionId ??= randomUUID()
    }
    if (action) await validateComputerProviderActionParams(method as Parameters<typeof validateComputerProviderActionParams>[0], params)
    const nativeParams: Record<string, unknown> = { ...params, ...(sessionId ? {session:sessionId} : {}) }
    delete nativeParams.sessionId
    const nativeCall=typeof this.native==='function' ? this.native : this.native.call.bind(this.native)
    try {
    const result = await nativeCall(method === 'capabilities' ? 'handshake' : method, nativeParams)
    if (method === 'capabilities') {
      const capabilities=result as ComputerProviderCapabilities
      return {...capabilities,supports:{...capabilities.supports,observation:{...capabilities.supports.observation,treeDiff:true}}}
    }
    if (sessionId && result && typeof result === 'object') {
      let normalized = result as ComputerSnapshotResult | ComputerActionResult
      if (action) {
        const actionResult=normalizeComputerActionResult(result as ComputerActionResult)
        normalized=actionResult.observationError ? actionResult : rejectContradictedComputerAction(actionResult)
      }
      if (normalized.snapshot) {
        this.sessions.set(sessionId as string, {
          observedAt:Date.now(),
          app:String(params.app),
          windowId:normalized.snapshot.window.id,
          windowIndex:normalized.snapshot.window.index ?? params.windowIndex as number | undefined
        })
        normalized = this.baselines.apply(nativeParams,normalized)
      } else this.sessions.delete(sessionId as string)
      for (const [id,target] of this.sessions) if (Date.now()-target.observedAt > 120_000) this.sessions.delete(id)
      return {...normalized, sessionId}
    }
    return result
    } catch (error) {
      if (action && sessionId) {
        this.sessions.delete(sessionId as string)
        this.baselines.forget(nativeParams)
      }
      throw error
    }
  }
}
