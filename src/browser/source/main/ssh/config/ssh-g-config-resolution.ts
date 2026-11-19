export type SshResolvedConfig = {
  hostname: string
  user?: string
  port: number
  identityFile: string[]
  identityAgent?: string
  identitiesOnly: boolean
  forwardAgent: boolean
  /** Includes system GSSAPI defaults except HOME-divergent -F resolution, which skips site config. */
  gssapiAuthentication?: boolean
  proxyCommand?: string
  proxyUseFdpass: boolean
  proxyJump?: string
  controlMaster: string
  controlPath?: string
  controlPersist: string
  /** May hold the literal `none`, which OpenSSH prints for an explicit opt-out. */
  userKnownHostsFiles: string[]
  globalKnownHostsFiles: string[]
  strictHostKeyChecking: string
  hostKeyAlias?: string
  hashKnownHosts: boolean
  updateHostKeys: string
}
