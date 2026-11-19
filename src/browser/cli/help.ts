import type { CommandSpec } from './command-spec.js'
import { effectiveAllowedFlags, findCommandSpec, isCommandGroup, matches } from './args.js'
import { unknownCommandData } from './command-suggestion.js'
import { JavisError } from '../../runtime/error.js'
import { BROWSER_COMMAND_FLAG_HELP, BROWSER_FLAG_HELP_TEXT } from './browser-flag-help-text.js'

export function formatBrowserHelp(specs: CommandSpec[], commandPath: string[]): string {
  const exactSpec = findCommandSpec(specs, commandPath)
  if (exactSpec) return formatCommandHelp(exactSpec)
  if (commandPath.length === 0 || isCommandGroup(specs, commandPath)) return formatGroupHelp(specs, commandPath)
  throw new JavisError('invalid_argument', `Unknown command: ${commandPath.join(' ')}`, unknownCommandData(specs, commandPath))
}

function formatCommandHelp(spec: CommandSpec): string {
  const lines = [`javis browser ${spec.path.join(' ')}`, '', `Usage: ${spec.usage}`, '', spec.summary]
  const displayedFlags = effectiveAllowedFlags(spec)
  if (displayedFlags.length > 0) {
    lines.push('', 'Options:')
    for (const flag of displayedFlags) {
      const help = BROWSER_COMMAND_FLAG_HELP[spec.path.join(' ')]?.[flag] ?? BROWSER_FLAG_HELP_TEXT[flag] ?? `--${flag}`
      lines.push(`  ${help}`)
    }
  }
  if (spec.notes && spec.notes.length > 0) {
    lines.push('', 'Notes:')
    for (const note of spec.notes) lines.push(`  ${note}`)
  }
  if (spec.examples && spec.examples.length > 0) {
    lines.push('', 'Examples:')
    for (const example of spec.examples) lines.push(`  $ ${example}`)
  }
  return lines.join('\n')
}

function formatGroupHelp(specs: CommandSpec[], groupPath: string[]): string {
  const group = ['javis', 'browser', ...groupPath].join(' ')
  const lines = [group, '', `Usage: ${group} <command> [options]`, '', 'Commands:']
  for (const spec of specs) {
    if (spec.hidden === true || spec.path.length <= groupPath.length || !matches(spec.path.slice(0, groupPath.length), groupPath)) continue
    lines.push(`  ${spec.path.slice(groupPath.length).join(' ').padEnd(18)} ${spec.summary}`)
  }
  lines.push('', `Run \`${group} <command> --help\` for command-specific usage.`)
  return lines.join('\n')
}
