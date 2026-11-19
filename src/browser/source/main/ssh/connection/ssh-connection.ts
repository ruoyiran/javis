import type { Client } from 'ssh2'
import type { SshTarget, SshConnectionState } from '../../../shared/ssh-types'
import type { RemoteInstallTransport } from '../../managed-server/install/remote-install-transport'
import type { SystemSshBuildArgsOptions } from '../system-transport/system-ssh-args'
export type SshConnection = Pick<RemoteInstallTransport, 'exec' | 'execWithClosedStdin' | 'usesSystemSshTransport'> & {
  getClient(): Client | null
  getState(): SshConnectionState
  getTarget(): SshTarget
  getSystemSshBuildArgsOptions(): SystemSshBuildArgsOptions
}
