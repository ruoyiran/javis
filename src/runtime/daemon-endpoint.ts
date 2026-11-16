import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'
import { JavisError } from './error.js'

export type DaemonEndpoint = {
  directory: string
  address: string
  lockPath: string
  tokenPath: string
  namedPipe: boolean
}

function pipeAddress(directory: string): string {
  const scope = createHash('sha256').update(directory.toLowerCase()).digest('hex').slice(0, 24)
  return `\\\\.\\pipe\\javis-${scope}`
}

export function daemonEndpoint(
  platform: NodeJS.Platform = process.platform,
  home: string = process.env.HOME ?? process.env.USERPROFILE ?? '',
  env: NodeJS.ProcessEnv = process.env
): DaemonEndpoint {
  let directory: string
  let address: string
  let namedPipe = false
  if (platform === 'darwin') {
    directory = posix.join(home, 'Library/Application Support/Javis')
    address = posix.join(directory, 'daemon.sock')
  } else if (platform === 'linux') {
    directory = env.XDG_RUNTIME_DIR
      ? posix.join(env.XDG_RUNTIME_DIR, 'javis')
      : posix.join(home, '.local/state/javis')
    address = posix.join(directory, 'daemon.sock')
  } else if (platform === 'win32') {
    directory = win32.join(env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'), 'Javis')
    address = pipeAddress(directory)
    namedPipe = true
  } else {
    throw new JavisError('unsupported_platform', `Javis computer use is unsupported on ${platform}`)
  }
  if (env.JAVIS_STATE_DIR !== undefined) {
    const paths = namedPipe ? win32 : posix
    if (!paths.isAbsolute(env.JAVIS_STATE_DIR)) throw new JavisError('invalid_argument', 'JAVIS_STATE_DIR must be an absolute path')
    directory = paths.normalize(env.JAVIS_STATE_DIR)
    address = namedPipe ? pipeAddress(directory) : posix.join(directory, 'daemon.sock')
  }
  return {
    directory,
    address,
    lockPath: (namedPipe ? win32 : posix).join(directory, 'daemon.lock'),
    tokenPath: (namedPipe ? win32 : posix).join(directory, 'daemon.token'),
    namedPipe
  }
}
