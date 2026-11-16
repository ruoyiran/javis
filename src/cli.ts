import { runCli } from './cli/run-cli.js'
import { runJavisDaemon, stopJavisDaemon } from './runtime/public.js'
import { runJavisMcp } from './mcp/server.js'
import { installAgent } from './agent/install.js'

const argv = process.argv.slice(2)

const help = `Javis macOS computer use

Usage:
  javis capabilities [--json]
  javis permissions status|open [--id accessibility|screenshots] [--json]
  javis list-apps [--json]
  javis list-windows --app <bundle-id|name|pid:N> [--json]
  javis get-app-state --app <app> [--window-id N|--window-index N] [--query TEXT] [--max-elements N] [--no-screenshot] [--json]
  javis <action> --app <app> --session <result.sessionId> [action flags] [--json]
  javis mcp
  javis daemon stop
  javis agent install codex|claude|all

Actions: click, set-value, type-text, press-key, hotkey, paste-text, scroll, drag, perform-secondary-action.
Run javis <action> with the required flags, then inspect the returned snapshot before another action.
`

async function main(): Promise<number> {
  if (argv[0] === '--internal-daemon') {
    await runJavisDaemon()
    return 0
  }
  if (argv[0] === 'mcp') {
    await runJavisMcp()
    return 0
  }
  if (argv[0] === 'daemon' && argv[1] === 'stop' && argv.length === 2) {
    await stopJavisDaemon()
    console.log('Javis daemon stopped.')
    return 0
  }
  if (argv[0] === 'agent') {
    if (argv[1] !== 'install' || !['codex', 'claude', 'all'].includes(argv[2] ?? '') || argv.length !== 3) {
      console.error('Usage: javis agent install codex|claude|all')
      return 1
    }
    await installAgent(argv[2] as 'codex' | 'claude' | 'all')
    console.log(`Installed Javis MCP and Skill for ${argv[2]}.`)
    return 0
  }
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    console.log(help)
    return 0
  }
  if (argv[0] === '--version') {
    console.log('0.1.0')
    return 0
  }
  return runCli(argv)
}

main().then((status) => { process.exitCode = status }).catch((error) => {
  console.error(`javis: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
