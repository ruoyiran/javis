# Agent instructions for Javis

Javis is a standalone computer-use project for macOS, Linux, and Windows desktop hosts. Work in this repository only. Orca supplied the original MIT-licensed implementation; Javis must have no source, build, or runtime dependency on a sibling checkout. Its phone-browser UI controls a Javis desktop host; Orca Mobile has no computer-use route.

## Read first

- [Design](docs/design.md): product scope and decisions.
- [Architecture](docs/architecture.md): process boundaries, platform providers, remote routing, sessions, and lifecycle.
- [Protocol](docs/protocol.md): CLI, MCP, SSH bridge, mobile, and provider contracts.
- [Testing](docs/testing.md): automated, platform, and desktop validation.
- [Operations](docs/operations.md): platform setup, signing, permissions, installation, and recovery.

## Build and verification

```bash
npm ci
npm run typecheck
npm test
npm run build
```

On macOS also run `swift test --package-path native/javis-macos`; verify the signed app after building. On Linux run the Python provider unit tests, and on Windows run the PowerShell provider checks in an isolated graphical session.

The local installer is `npm run install:local`. On macOS it changes `~/Applications/Javis.app` and `~/.local/bin/javis`; on Linux/Windows it installs `dist/` into a user-local directory and writes a launcher tied to the install-time Node path. Run it only when the task includes installation or upgrade. `javis agent install all` separately changes Codex and Claude Code user configuration and skills. Linux provider tests use Python 3; Windows PowerShell UI Automation integration requires Windows CI or a Windows desktop test session. Never describe a macOS run as Windows GUI verification.

## Code boundaries

- `native/javis-macos/` owns the signed helper, Accessibility, window capture, input delivery, permission UI, and native peer authentication.
- `native/javis-linux/` owns the Python 3 AT-SPI provider; `native/javis-windows/` owns the PowerShell UI Automation provider. Each runs only in the selected user's graphical login.
- `src/runtime/` owns provider selection, the private local daemon, request queue, sessions, SSH stdio routing, and process cleanup. `src/contract/` defines shared result shapes and error recovery advice.
- `src/cli/`, `src/mcp/`, `src/settings/`, `src/mobile/`, and `src/agent/` are adapters over that runtime. Keep action semantics aligned across entry points.
- `scripts/` builds and installs Javis on each supported platform; macOS alone has the signed app packaging path. Do not reintroduce Electron, Orca RPC, or `@orca/*` imports.

## Invariants

- An action requires a fresh session or worktree/folder context; an indexed action uses an element index from a prior observation on the same host and context. The context is a session namespace, not a desktop or host selector. Never automatically replay an action after an uncertain delivery.
- Preserve `action`, `verification`, and `observationError` when input was delivered but the follow-up snapshot failed. A null snapshot must never be presented as fresh state.
- The macOS helper accepts only its authenticated controller PID, same UID, one-time token, and trusted signed controller identity. Keep daemon and helper endpoints private. SSH uses an allowlisted stdio bridge; only the separate paired HTTPS mobile gateway may listen on a network address.
- Normal observations must not activate a target app. Background actions must preserve focus where the provider supports them; foreground input requires explicit `restoreWindow`.
- Never put raw input text, accessibility trees, or screenshot bytes in diagnostics or test logs. Keep secure-field redaction and blocked-app checks intact.
- A mobile action is bound to the paired device's stored app, window, and session. Require pairing and CSRF checks; after an ambiguous action failure, require a fresh observation before acting again.

## Testing on a desktop

Run unit and protocol tests freely. Launch any app or helper test without stealing the user's focus. Read-only checks against an existing window require task authorization. Tests that click, type, drag, change focus, or open native permission UI belong in an isolated graphical session or CI on the relevant OS. Do not use the user's active desktop as a mutable fixture.

Use a test only when it catches a concrete regression in the layer that owns the behavior. Update the relevant document when changing the public contract, process topology, permission identity, or release steps. Before a commit, run the affected checks and inspect `git diff --check`; verify Orca's working tree remains untouched when extracting or comparing source.
