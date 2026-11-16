import { randomUUID } from 'node:crypto'
import { JavisError } from './error.js'
import { validateComputerProviderActionParams } from './computer-provider-action-validation.js'
import { ComputerTreeBaselines } from './computer-snapshot-tree-diff.js'
import { normalizeComputerActionResult, rejectContradictedComputerAction } from './computer-action-verification-normalization.js'
import type { ComputerActionResult, ComputerSnapshotResult, ComputerProviderCapabilities } from '../contract/computer-use-runtime-types.js'
export type JavisMethod = 'capabilities' | 'listApps' | 'listWindows' | 'getAppState' | 'click' | 'performSecondaryAction' | 'scroll' | 'drag' | 'typeText' | 'pressKey' | 'hotkey' | 'pasteText' | 'setValue'
export class SessionRuntime {
  private sessions = new Map<string, number>()
  private baselines = new ComputerTreeBaselines()
  constructor(private native: (method: string, params: Record<string, unknown>) => Promise<unknown>) {}
  async call(method: JavisMethod, params: Record<string, unknown>): Promise<unknown> {
    if (!['capabilities','listApps','listWindows','getAppState','click','performSecondaryAction','scroll','drag','typeText','pressKey','hotkey','pasteText','setValue'].includes(method)) throw new JavisError('invalid_argument','Unknown method')
    const action = !['capabilities','listApps','listWindows','getAppState'].includes(method)
    let sessionId = params.sessionId
    if (action || method === 'getAppState') {
      if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId)) throw new JavisError('invalid_argument','sessionId must be a non-empty string')
      if (action && typeof sessionId !== 'string') throw new JavisError('invalid_argument','Actions require sessionId from getAppState')
      if (action && (!this.sessions.has(sessionId as string) || Date.now() - this.sessions.get(sessionId as string)! > 120_000)) throw new JavisError('stale_snapshot','Refresh getAppState before acting')
      sessionId ??= randomUUID()
    }
    if (action) await validateComputerProviderActionParams(method as Parameters<typeof validateComputerProviderActionParams>[0], params)
    const nativeParams: Record<string, unknown> = { ...params, ...(sessionId ? {session:sessionId} : {}) }
    delete nativeParams.sessionId
    const result = await this.native(method === 'capabilities' ? 'handshake' : method, nativeParams)
    if (method === 'capabilities') {
      const capabilities=result as ComputerProviderCapabilities
      return {...capabilities,supports:{...capabilities.supports,observation:{...capabilities.supports.observation,treeDiff:true}}}
    }
    if (sessionId && result && typeof result === 'object') {
      this.sessions.set(sessionId as string, Date.now())
      for (const [id,time] of this.sessions) if (Date.now()-time > 120_000) this.sessions.delete(id)
      let normalized = result as ComputerSnapshotResult | ComputerActionResult
      if (action) {
        const actionResult=normalizeComputerActionResult(result as ComputerActionResult)
        normalized=actionResult.observationError ? actionResult : rejectContradictedComputerAction(actionResult)
      }
      if (normalized.snapshot) normalized = this.baselines.apply(nativeParams,normalized)
      return {...normalized, sessionId}
    }
    return result
  }
}
