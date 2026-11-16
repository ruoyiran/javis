# Agent instructions for Javis

Javis is a standalone macOS computer-use project. Work in this repository only. The Orca project supplied the original MIT-licensed implementation; Javis must have no source, build, or runtime dependency on a sibling checkout.

## Read first

- [Design](docs/design.md): product scope and decisions.
- [Architecture](docs/architecture.md): process boundaries, permissions, snapshots, and lifecycle.
- [Protocol](docs/protocol.md): CLI, MCP, and helper contracts.
- [Testing](docs/testing.md): automated and desktop validation.
- [Operations](docs/operations.md): signing, installation, and recovery.

## Build and verification

```bash
npm ci
npm run typecheck
npm test
swift test --package-path native/javis-macos
npm run build
```

The local installer is `npm run install:local`. It changes `~/Applications/Javis.app` and `~/.local/bin/javis`; run it only when the task includes installation or upgrade. `javis agent install all` separately changes Codex and Claude Code user configuration and skills.

## Code boundaries

- `native/javis-macos/` owns the signed helper, Accessibility, window capture, input delivery, permission UI, and native peer authentication.
- `src/runtime/` owns the local daemon, request queue, sessions, helper connection, and process cleanup. `src/contract/` defines shared result shapes.
- `src/cli/`, `src/mcp/`, and `src/agent/` are adapters over that runtime. Keep action semantics aligned across CLI and MCP.
- `scripts/` builds and installs the self-contained app. Do not reintroduce Electron, Orca RPC, or `@orca/*` imports.

## Invariants

- An action requires a fresh session; an indexed action uses an element index from a prior observation. Never automatically replay an action after an uncertain delivery.
- Preserve `action`, `verification`, and `observationError` when input was delivered but the follow-up snapshot failed. A null snapshot must never be presented as fresh state.
- The native helper accepts only its authenticated controller PID, same UID, and one-time token. Keep the daemon and helper sockets private; never expose a network listener.
- Normal observations and background actions must not activate a target app. Foreground input requires explicit `restoreWindow`.
- Never put raw input text, accessibility trees, or screenshot bytes in diagnostics or test logs. Keep secure-field redaction and blocked-app checks intact.

## Testing on a desktop

Run unit and protocol tests freely. Launch any app or helper test without stealing the user's focus. Read-only checks against an existing window require task authorization; tests that click, type, drag, change focus, or open native permission UI belong in an isolated macOS graphical session or CI. Do not use the user's active desktop as a mutable fixture.

Use a test only when it catches a concrete regression in the layer that owns the behavior. Update the relevant document when changing the public contract, process topology, permission identity, or release steps. Before a commit, run the affected checks and inspect `git diff --check`; verify Orca's working tree remains untouched when extracting or comparing source.
