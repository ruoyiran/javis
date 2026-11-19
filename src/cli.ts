import { runCli } from './cli/run-cli.js'
import { runJavisDaemon, stopJavisDaemon } from './runtime/public.js'
import { runJavisMcp } from './mcp/server.js'
import { installAgent, readAgentInstallStatus } from './agent/install.js'
import { runJavisStdioRpc, runBrowserRemoteStdioBridge } from './runtime/remote-stdio.js'
import { startJavisSettings } from './settings/server.js'
import { startMobileGateway } from './mobile/gateway.js'
import { spawn } from 'node:child_process'
import { callJavis } from './runtime/public.js'
import { JAVIS_VERSION } from './version.js'

const argv = process.argv.slice(2)

const help = `Javis computer use and built-in browser

Usage:
  javis computer <command> [flags] (run javis computer --help for the command list)
  javis browser <command> [flags] (run javis browser --help for browser commands)
  javis browser open [--worktree CONTEXT]
  javis browser tab create --url URL [--host SSH_ALIAS] [--json]
  javis capabilities [--json]
  javis permissions status [--host SSH_ALIAS] [--json]
  javis permissions open [--id accessibility|screenshots] [--json]
  javis permissions reset [--json]
  javis list-apps [--json]
  javis list-windows --app <bundle-id|name|pid:N> [--json]
  javis get-app-state --app <app> [--host SSH_ALIAS] [--worktree ID] [--window-id N|--window-index N] [--query TEXT] [--max-elements N] [--no-screenshot] [--json]
  javis <action> --app <app> [--host SSH_ALIAS] [--session ID|--worktree ID] [action flags] [--json]
  javis mcp
  javis rpc --stdio
  javis settings serve|open [--port N]
  javis mobile serve [--bind IP] [--port N] [--cert PEM --key PEM]
  javis daemon stop
  javis agent install codex|claude|all

Actions: click, set-value, type-text, press-key, hotkey, paste-text, scroll, drag, perform-secondary-action.
Run javis <action> with the required flags, then inspect the returned snapshot before another action.
`

function options(args: string[], allowed: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]
    if (!flag?.startsWith('--') || !allowed.includes(flag) || !value || value.startsWith('--') || parsed.has(flag)) {
      throw new Error(`Invalid option ${flag ?? '(missing)'}`)
    }
    parsed.set(flag, value)
  }
  return parsed
}

function portOf(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer from 0 to 65535')
  return port
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', error => console.error(`Could not open browser: ${error.message}; use the printed URL.`))
  child.unref()
}

async function main(): Promise<number> {
  if (argv[0] === '--internal-daemon') {
    await runJavisDaemon()
    return 0
  }
  if (argv[0] === 'mcp') {
    await runJavisMcp()
    return 0
  }
  if (argv[0] === 'rpc' && argv[1] === '--stdio' && argv.length === 2) {
    await runJavisStdioRpc()
    return 0
  }
  if (argv[0] === 'rpc' && argv[1] === '--stream-stdio' && argv.length === 2) {
    await runBrowserRemoteStdioBridge()
    return 0
  }
  if (argv[0] === 'settings' && (argv[1] === 'serve' || argv[1] === 'open')) {
    const flags = options(argv.slice(2), ['--port'])
    const settings = await startJavisSettings({
      port: portOf(flags.get('--port'), 0),
      permissions: {
        status: () => callJavis('permissionsStatus', {}),
        open: id => callJavis('permissionsOpen', { id }),
        reset: () => callJavis('permissionsReset', {})
      },
      installAgent,
      agentStatus: async () => await Promise.all([
        readAgentInstallStatus('codex'), readAgentInstallStatus('claude')
      ])
    })
    console.log(`Javis settings: ${settings.url}`)
    if (argv[1] === 'open') openBrowser(settings.url)
    return 0
  }
  if (argv[0] === 'mobile' && argv[1] === 'serve') {
    const flags = options(argv.slice(2), ['--bind', '--port', '--cert', '--key'])
    const gateway = await startMobileGateway({
      bind: flags.get('--bind') ?? '127.0.0.1',
      port: portOf(flags.get('--port'), 8787),
      ...(flags.get('--cert') ? { cert: flags.get('--cert') } : {}),
      ...(flags.get('--key') ? { key: flags.get('--key') } : {}),
      call: callJavis
    })
    console.log(`Javis mobile: ${gateway.url}\nPairing code: ${gateway.pairingCode}`)
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
  if (argv.length > 1 && ['help', '--help', '-h'].includes(argv[0])) return runCli(argv)
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    console.log(help)
    return 0
  }
  if (argv[0] === '--version') {
    console.log(JAVIS_VERSION)
    return 0
  }
  return runCli(argv)
}

main().then((status) => { process.exitCode = status }).catch((error) => {
  console.error(`javis: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
