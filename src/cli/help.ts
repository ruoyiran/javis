import type { CliArguments } from './arguments.js'

const observeFlags = '[--host SSH_ALIAS] [--session ID|--worktree ID] [--window-id N|--window-index N] [--restore-window] [--no-screenshot]'
const actionFlags = `${observeFlags} [--full-tree] [--json]`

const commands: Record<string, { summary: string; flags: string }> = {
  capabilities: { summary: 'Show provider capabilities', flags: '[--host SSH_ALIAS] [--json]' },
  'list-apps': { summary: 'List running apps', flags: '[--host SSH_ALIAS] [--json]' },
  permissions: { summary: 'Open macOS permission setup', flags: '[--id accessibility|screenshots] [--json]' },
  'list-windows': { summary: 'List app windows', flags: '--app <name|bundle|pid:N> [--host SSH_ALIAS] [--json]' },
  'get-app-state': { summary: 'Observe an app without activating it', flags: `--app <app> ${observeFlags} [--query TEXT] [--max-elements N] [--json]` },
  click: { summary: 'Click an element or window coordinate', flags: `--app <app> (--element-index N|--x X --y Y) [--click-count N] [--mouse-button left|right|middle] [--modifiers CHORD] ${actionFlags}` },
  'perform-secondary-action': { summary: 'Perform an advertised accessibility action', flags: `--app <app> --element-index N --action NAME ${actionFlags}` },
  scroll: { summary: 'Scroll an element or window coordinate', flags: `--app <app> (--element-index N|--x X --y Y) --direction up|down|left|right [--pages N] ${actionFlags}` },
  drag: { summary: 'Drag between elements or window coordinates', flags: `--app <app> (--from-element-index N --to-element-index N|--from-x X --from-y Y --to-x X --to-y Y) ${actionFlags}` },
  'type-text': { summary: 'Type literal text', flags: `--app <app> (--text TEXT|--text-stdin) ${actionFlags}` },
  'press-key': { summary: 'Press one key, such as Return or Escape', flags: `--app <app> --key KEY ${actionFlags}` },
  hotkey: { summary: 'Press a modifier chord, such as CmdOrCtrl+A', flags: `--app <app> --key CHORD ${actionFlags}` },
  'paste-text': { summary: 'Paste exact text', flags: `--app <app> (--text TEXT|--text-stdin) ${actionFlags}` },
  'set-value': { summary: 'Set or clear an element value', flags: `--app <app> --element-index N (--value TEXT|--value-stdin) ${actionFlags}` }
}

const safety = 'Observe before acting in the same host and context. Element indexes come from the fresh tree. Coordinates are window-local points; divide screenshot pixels by screenshot.scale. After uncertain delivery, inspect current state before another action.'

export function computerHelp(parsed: CliArguments): string | undefined {
  let path = parsed.command
  let requested = parsed.flags.has('help')
  if (path[0] === 'help') { requested = true; path = path.slice(1) }
  const namespaced = path[0] === 'computer'
  let args = namespaced ? path.slice(1) : path
  if (args[0] === 'help') { requested = true; args = args.slice(1) }
  const general = namespaced && args.length === 0
  if (general) return [
    'Javis computer use', '', 'Usage: javis computer <command> [flags]', '',
    ...Object.entries(commands).map(([name, command]) => `  ${name.padEnd(26)} ${command.summary}`), '',
    'Run javis computer <command> --help for all flags. Flat javis <command> commands are also supported.', '', safety
  ].join('\n')
  const command = commands[args[0]]
  if (!command || !requested) return undefined
  const prefix = namespaced ? 'javis computer' : 'javis'
  return [command.summary, '', `Usage: ${prefix} ${args[0]} ${command.flags}`,
    ...(args[0] === 'permissions' ? [
      `${prefix} permissions status [--host SSH_ALIAS] [--json]`,
      `${prefix} permissions open [--id accessibility|screenshots] [--json]`,
      `${prefix} permissions reset [--json]`
    ] : []), '', safety].join('\n')
}
