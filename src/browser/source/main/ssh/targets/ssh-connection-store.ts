import type { SshTarget } from '../../../shared/ssh-types'
export type SshConnectionStore = {
  getTarget(targetId: string): SshTarget | undefined
  listTargets(): SshTarget[]
  listRemovedTargetLabels(): Record<string, string>
}
