import type { SshConnection } from './ssh-connection'
export type SshConnectionManager = { getConnection(targetId: string): SshConnection | undefined }
