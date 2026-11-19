import type { ClientChannel } from 'ssh2'
import type { ChildProcess } from 'node:child_process'
export type SystemSshCommandChannel = ClientChannel & { _process?: ChildProcess; _closeRequested?: boolean }
