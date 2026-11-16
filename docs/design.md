# Javis design

## Intent and scope

Javis makes desktop computer use available to agents without an Orca checkout or process. It has a CLI, MCP stdio server, Agent Skill, local settings page, and separately paired mobile browser page. The mobile page controls a desktop Javis installation; it does not control phone apps. Orca Mobile has no computer-use route, so this phone page is a Javis addition beyond Orca parity.

The desktop scope follows Orca computer use at commit `729f757b592244176420a86114c1ea23911eeeba`: app and window discovery, observation, nine actions, capabilities, and permission status/setup where the platform supplies it. Javis owns its public names and result envelopes. The original MIT notice remains in [LICENSE](../LICENSE).

## Decisions

| Decision | Reason and consequence |
| --- | --- |
| Independent repository and runtime | Source, build, and installed runtime cannot depend on a sibling Orca checkout, RPC, or package. |
| Platform providers behind one daemon contract | A signed Swift helper serves macOS, Python 3/AT-SPI serves Linux, and Windows PowerShell UI Automation serves Windows. Capabilities report actual support, including missing optional Linux tools and Wayland limits. |
| On-demand per-user daemon | It serializes provider requests and retains short-lived element identity and per-context tree baselines across CLI calls. Unix sockets are private on macOS/Linux; Windows uses a token-authenticated per-user named pipe. |
| Explicit SSH host routing | `--host` or MCP `host` selects a Javis installation through `ssh -T <alias> javis rpc --stdio`. SSH checks host identity; no daemon/helper TCP listener is opened. A disconnected or timed-out action is not retried. |
| Context separate from host | `--worktree <opaque ID>` is a session namespace on the selected host, not a path requirement or desktop selector. The default context is the canonical current directory, including non-Git folders. Explicit `--session` is exclusive with `--worktree`. |
| Authenticated macOS helper | LaunchServices gives the signed app its stable privacy identity. Controller PID, same UID, one-time token, and trusted signature restrict its helper connection; each process generation gets a fresh socket and token. |
| Delivered-action result survives read failure | `action`, `verification`, and `observationError` remain available when input was delivered but the next observation failed. A null snapshot is never fresh state and must not trigger replay. |
| Local settings page | A loopback-only, tokenized view presents macOS permission states, setup/reset controls, and Agent installation state. Normal observation never opens System Settings. |
| Paired HTTPS mobile gateway | It is a separate server with a short-lived one-time pairing code, per-device sessions, CSRF checks, and no-store responses. It forwards only allowed computer calls to the private local daemon. |

## Behavior contract

The normal loop is observe → act → observe. An indexed action must use a fresh observation of the same app, window, host, and context. Window ID and window index cannot be supplied together. Action results default to a tree diff, with full-tree opt-in. Screenshot coordinates are window-local points; image pixels must be divided by `screenshot.scale`. Remote image bytes are materialized into a private temporary file on the caller, never exposed as a path on the remote host.

Native accessibility actions are preferred. Synthetic input and clipboard delivery may remain unverified; semantic value writes can be read back. `restoreWindow` is an explicit foreground choice because it can change focus and pointer position. Linux and Windows synthetic input may need the interactive foreground desktop; background capability is platform dependent. A timeout, transport loss, or post-action `observationError` requires a fresh inspection before any new action.

The helper/provider blocks protected apps and redacts secure fields. Diagnostics never contain raw typed text, accessibility trees, or screenshot bytes. The mobile gateway stores the selected app/window and Javis session per paired device, not in trusted browser action payloads. After ambiguous delivery it disables actions until observation succeeds; it never resends an action automatically.

## Acceptance and limits

Acceptance requires a clean copy building without Orca imports, TypeScript tests and typecheck, Swift tests and signed build on macOS, Python provider tests, PowerShell/provider integration on Windows CI, and reproducible read-only desktop smoke checks on authorized windows. Mutable desktop checks belong in isolated graphical sessions. A macOS run cannot prove Windows GUI behavior. See [testing](testing.md).

The current macOS app packaging targets arm64 and x64 macOS 14+. Linux depends on the active graphical login, AT-SPI, and optional tools for some actions; Wayland may omit screenshots or X11-only input. Windows depends on an interactive desktop and PowerShell UI Automation. Capability responses, not a cross-platform assumption, determine what can be attempted. Local installation is supported on all three systems; signed app packaging applies only to macOS.
