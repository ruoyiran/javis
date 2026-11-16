# Javis

Javis is an independent computer-use runtime for desktop agents on macOS, Linux, and Windows. It reads app accessibility trees, captures supported window screenshots, and performs element or coordinate actions through a CLI, an MCP stdio server, and an Agent Skill. It can target a Javis installation on another desktop through SSH. A separately paired HTTPS page lets a phone browser control that desktop. Javis builds and runs without an Orca checkout or process.

Project references: [usage examples](docs/examples.md) · [design](docs/design.md) · [architecture](docs/architecture.md) · [CLI and MCP protocol](docs/protocol.md) · [testing](docs/testing.md) · [operations](docs/operations.md) · [agent instructions](AGENTS.md).

## Platform requirements

| Host | Native provider and prerequisites | Current limit |
| --- | --- | --- |
| macOS | arm64 or x64, macOS 14+, Swift 6, Xcode command line tools, a signed `Javis.app`; Accessibility and Screen Recording grants as needed | App signing and privacy grants apply only to macOS. |
| Linux | Python 3 with PyGObject and AT-SPI (`python3-gi`, `gir1.2-atspi-2.0`, `at-spi2-core`) in an active graphical login | X11 offers broader screenshot and synthetic input support; Wayland and missing optional tools reduce reported capabilities. |
| Windows | Windows PowerShell 5.1 with .NET UI Automation in the user's interactive desktop | Native GUI verification must run on Windows; a macOS build cannot establish it. |

Build scripts need Node 22+ and npm. The macOS app bundles an architecture-matched Node 24+ runtime; set `JAVIS_NODE_PATH` to choose it explicitly. The JavaScript CLI targets Node 22, so use Node 22+ when installing on Linux or Windows. Their launcher records that executable's absolute path; keep it available. The provider scripts are copied into `dist/native/` by the build. Use `javis capabilities --json` on each host to see the actual supported methods before acting.

## Build and install

On macOS:

```bash
npm ci
npm run typecheck
npm test
swift test --package-path native/javis-macos
npm run build
npm run install:local
```

The macOS installer copies `Javis.app` to `~/Applications` and creates `~/.local/bin/javis`. On Linux and Windows, run `npm ci && npm run build && npm run install:local`: the installer copies `dist/` to a user-local location and creates a launcher using the install-time Node executable's absolute path. Add the printed launcher directory to `PATH` if needed. macOS app signing does not apply to Linux/Windows. See [operations](docs/operations.md) for native dependencies and platform setup.

On macOS, inspect and grant permissions to the signed **Javis** app:

```bash
javis permissions status --json
javis permissions open
```

Accessibility is needed for trees and actions. Screen Recording is needed for screenshots; `--no-screenshot` requests a tree only. The settings view, `javis settings open`, shows both permission states, setup/reset controls, and Agent installation state. Opening System Settings is an explicit action.

## Agent setup

```bash
javis agent install all
```

This installs the Javis Skill and user-level MCP stdio registration for Codex and Claude Code. `javis agent install codex` or `javis agent install claude` selects one. The installer refuses to overwrite an edited skill or an unrelated registration with the same name.

## Observe, act, verify

```bash
javis list-apps --json
javis get-app-state --app com.apple.finder --json
javis click --app com.apple.finder --session <result.sessionId> --element-index <index-from-tree> --json
```

An observation returns a session ID. An action can use that ID, the same explicit `--worktree <opaque-id>` used for observation, or the canonical current-directory context when both flags are omitted. A worktree or ordinary folder names an isolated snapshot context on the selected host; it does not select a desktop or SSH host. Element indexes must come from a fresh observation in that same context. Action results default to a compact tree diff; `--full-tree` requests the complete tree. CLI screenshots are normally materialized in a private temporary file; MCP returns image content. If temporary-file creation fails, CLI retains the inline image and a warning.

The provider attempts background input where available. `--restore-window` explicitly requests foreground delivery and may move focus or the pointer. Inspect `action.verification` and the returned snapshot before claiming an action worked. If input was delivered but a later observation failed, Javis returns `action` and `observationError` with a null snapshot. After that result, a timeout, or an SSH disconnect, inspect current state before any new action; never automatically replay it.

For a remote desktop, install Javis on that host and use an OpenSSH alias:

```bash
javis get-app-state --host office-desktop --app <app> --worktree <context-id> --json
javis click --host office-desktop --app <app> --worktree <context-id> --element-index <fresh-index> --json
```

The CLI uses `ssh -T <alias> javis rpc --stdio`. SSH handles host identity; no Javis daemon or helper socket is exposed on TCP. Remote screenshot bytes are materialized on the caller's machine. See [examples](docs/examples.md) for local and remote workflows.

## Phone browser

Run the gateway on the desktop host that should be controlled:

```bash
javis mobile serve --bind <LAN-IP> --port 8787 --cert <certificate.pem> --key <private-key.pem>
```

Open the printed HTTPS URL on the phone and enter the one-time pairing code within five minutes. Non-loopback binds require TLS; plain HTTP is restricted to loopback for local testing or a trusted local reverse proxy. The phone page lists apps and windows, observes screenshots and trees, and offers the nine Javis actions. It controls the desktop host, never the phone's own apps. Orca Mobile has no computer-use route; this is a Javis feature beyond Orca parity. The gateway calls the private local daemon and never publishes its socket.

## Project boundary

macOS uses a signed Swift helper; Linux uses a Python AT-SPI provider; Windows uses a PowerShell UI Automation provider. The per-user daemon owns sessions and serializes requests. It exposes a private local endpoint only: a Unix socket on macOS/Linux or a per-user named pipe on Windows. `javis daemon stop` shuts it down. The optional HTTPS mobile gateway is a separate authenticated network service.

The native implementation originated in the MIT-licensed Orca Computer Use project. The original notice remains in [LICENSE](LICENSE). See [operations](docs/operations.md) for daemon recovery and platform-specific limits.
