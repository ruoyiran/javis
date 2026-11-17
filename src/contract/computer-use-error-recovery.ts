export function computerUseNextSteps(code: string, message?: string): string[] {
  switch (code) {
    case 'action_timeout':
      return [
        'Action delivery may be uncertain. Inspect the current app or destination with a fresh observation; do not automatically repeat the action.'
      ]
    case 'transport_error':
      return [
        'Action delivery may be uncertain. Inspect the current app or destination with a fresh observation; do not automatically repeat the action.',
        'For a remote host, verify the SSH alias and that Javis is installed there before another request.'
      ]
    case 'element_not_found':
    case 'stale_snapshot':
      return [
        'Run javis get-app-state --app <app> --json in the same host and context, then select an element index from the fresh tree.'
      ]
    case 'window_not_found':
      return [
        'Run javis list-windows --app <app> --json on the selected host, then observe the intended window again before acting.',
        'If no windows are listed, open a visible window in the target app before observing it.'
      ]
    case 'window_stale':
      return [
        'Run javis list-windows --app <app> --json on the selected host, then observe the intended window again before acting.'
      ]
    case 'app_not_found':
      return [
        'Run javis list-apps --json on the selected host, then use the returned app name, bundle ID, or pid:N.',
        'For a website or web app, select the running desktop browser and its window with javis list-windows --app <browser> --json; website names are not desktop app selectors.'
      ]
    case 'app_blocked':
      return ['Stop using Javis on this protected app.']
    case 'permission_denied':
      return [
        'On macOS, run javis permissions status --json and grant the requested permission to Javis.app through javis permissions open.',
        "On Linux, use an active graphical login with AT-SPI available; on Windows, use the user's interactive desktop."
      ]
    case 'unsupported_capability':
      return [
        'Run javis capabilities --json on the selected host and choose a supported action.',
        'On Linux, install python3, python3-gi, gir1.2-atspi-2.0, and at-spi2-core for the interpreter Javis uses; install any optional desktop tool named in the error.'
      ]
    case 'background_unavailable':
      return [
        ...(/popup|<select>/i.test(message ?? '') ? ['Observe the popup element again and use javis set-value to select its option when supported.'] : []),
        'Observe the target again. If taking desktop focus is acceptable, request --restore-window explicitly for a new action.'
      ]
    case 'window_not_focused':
      if (message?.includes('may already have been delivered')) {
        return computerUseNextSteps('action_timeout')
      }
      if (/restore(?:-window|Window) was requested/i.test(message ?? '')) {
        return [
          'Observe the target again. Bring it forward manually or check desktop permissions before choosing a new action; use set-value for an editable field when supported.'
        ]
      }
      return [
        'Observe the target again. If taking desktop focus is acceptable, request --restore-window explicitly for a new action.'
      ]
    case 'provider_incompatible':
      return [
        'Install matching Javis CLI and provider versions on the selected host, then restart the Javis daemon.'
      ]
    case 'unsupported_platform':
      return [
        'Run Javis on a supported macOS, Linux, or Windows desktop host, or select one with --host <SSH alias>.'
      ]
    case 'provider_unavailable':
    case 'startup_error':
      return [
        'Verify Javis and its native provider are installed on the selected host, then run javis capabilities --json.'
      ]
    case 'startup_timeout':
    case 'shutdown_timeout':
      return [
        'Check the Javis daemon and provider on the selected host; observe the target before sending another action.'
      ]
    case 'access_denied':
      return [
        'Check that the Javis state directory is private and owned by the current user; verify the installed Javis.app identity on macOS.'
      ]
    case 'daemon_recovery_blocked':
      return [
        'Confirm no Javis daemon startup is running, remove only the stale daemon.lock.recovery directory named in the error, and retry.'
      ]
    case 'screenshot_failed':
      return [
        'Check screenshot permission or capture dependencies on the selected host; use --no-screenshot if an accessibility tree is enough.'
      ]
    case 'verification_failed':
      return [
        'Inspect the returned snapshot and target value before choosing another action; the first action may have been delivered.'
      ]
    case 'value_not_settable':
      return [
        'Observe the field again and use a supported keyboard action only after confirming its focus and editability.'
      ]
    case 'element_not_clickable':
    case 'action_not_supported':
      return [
        'Observe the element again and choose an advertised accessibility action or a supported alternative from javis capabilities --json.'
      ]
    case 'invalid_argument':
      return [
        'Check the command flags in docs/protocol.md; choose one window selector and either --session or --worktree.'
      ]
    case 'accessibility_error':
      return [
        'Refresh the target window and check javis capabilities --json on the selected host before another action.'
      ]
    default:
      return []
  }
}
