import { describe, expect, it } from 'vitest'
import { computerUseNextSteps } from '../../src/contract/computer-use-error-recovery.js'

describe('computerUseNextSteps', () => {
  it('treats action timeout and transport loss as uncertain delivery', () => {
    const expected = [
      'Action delivery may be uncertain. Inspect the current app or destination with a fresh observation; do not automatically repeat the action.'
    ]
    expect(computerUseNextSteps('action_timeout')).toEqual(expected)
    expect(computerUseNextSteps('transport_error')).toEqual([
      ...expected,
      'For a remote host, verify the SSH alias and that Javis is installed there before another request.'
    ])
  })

  it('gives a fresh-target recovery path for stale indexes and windows', () => {
    expect(computerUseNextSteps('element_not_found')).toEqual([
      'Run javis get-app-state --app <app> --json in the same host and context, then select an element index from the fresh tree.'
    ])
    expect(computerUseNextSteps('window_stale')).toEqual([
      'Run javis list-windows --app <app> --json on the selected host, then observe the intended window again before acting.'
    ])
  })

  it('offers platform-specific permission and dependency checks', () => {
    expect(computerUseNextSteps('permission_denied')).toEqual([
      'On macOS, run javis permissions status --json and grant the requested permission to Javis.app through javis permissions open.',
      'On Linux, use an active graphical login with AT-SPI available; on Windows, use the user\'s interactive desktop.'
    ])
    expect(computerUseNextSteps('unsupported_capability')).toEqual([
      'Run javis capabilities --json on the selected host and choose a supported action.',
      'On Linux, install python3, python3-gi, gir1.2-atspi-2.0, and at-spi2-core for the interpreter Javis uses; install any optional desktop tool named in the error.'
    ])
  })

  it('requires explicit foreground choice and stops at protected apps', () => {
    expect(computerUseNextSteps('background_unavailable')).toEqual([
      'Observe the target again. If taking desktop focus is acceptable, request --restore-window explicitly for a new action.'
    ])
    expect(computerUseNextSteps('app_blocked')).toEqual([
      'Stop using Javis on this protected app.'
    ])
  })

  it('explains provider setup and unknown codes without guessing', () => {
    expect(computerUseNextSteps('provider_incompatible')).toEqual([
      'Install matching Javis CLI and provider versions on the selected host, then restart the Javis daemon.'
    ])
    expect(computerUseNextSteps('unsupported_platform')).toEqual([
      'Run Javis on a supported macOS, Linux, or Windows desktop host, or select one with --host <SSH alias>.'
    ])
    expect(computerUseNextSteps('unknown_code')).toEqual([])
  })
})
