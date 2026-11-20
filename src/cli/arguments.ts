export class CliArgumentError extends Error {
  readonly code = 'invalid_argument'
}

const booleanFlags = new Set(['json', 'help', 'no-screenshot', 'restore-window', 'full-tree', 'text-stdin', 'value-stdin', 'activate', 'allow-system-shortcut'])
const valueFlags = new Set([
  'app', 'host', 'worktree', 'session', 'window-id', 'window-index', 'element-index', 'from-element-index',
  'to-element-index', 'x', 'y', 'from-x', 'from-y', 'to-x', 'to-y', 'click-count',
  'mouse-button', 'modifiers', 'action', 'direction', 'pages', 'text', 'key',
  'value', 'query', 'max-elements', 'id', 'enabled', 'window-title', 'timeout', 'screenshot-format', 'screenshot-scale', 'screenshot-max-edge'
])

export type CliArguments = { command: string[]; flags: Map<string, string | true> }

export function splitCliArguments(argv: string[]): CliArguments {
  const command: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (token === '-h') {
      if (flags.has('help')) throw new CliArgumentError('Duplicate flag --help')
      flags.set('help', true)
      continue
    }
    if (!token.startsWith('--')) { command.push(token); continue }
    const assignment = token.slice(2)
    const equals = assignment.indexOf('=')
    const name = equals < 0 ? assignment : assignment.slice(0, equals)
    if (!booleanFlags.has(name) && !valueFlags.has(name)) throw new CliArgumentError(`Unknown flag --${name}`)
    if (flags.has(name)) throw new CliArgumentError(`Duplicate flag --${name}`)
    if (equals >= 0) {
      const value = assignment.slice(equals + 1)
      if (name === 'activate' || name === 'allow-system-shortcut') {
        if (value !== 'true' && value !== 'false') throw new CliArgumentError(`--${name} must be true or false`)
        flags.set(name, value === 'true' ? true : 'false')
      } else flags.set(name, value)
    } else if (booleanFlags.has(name)) {
      flags.set(name, true)
    } else {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--') || (command.length === 0 && value === 'computer')) {
        throw new CliArgumentError(`Missing value for --${name}`)
      }
      flags.set(name, value)
      index++
    }
  }
  return { command, flags }
}
