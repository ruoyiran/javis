# Javis

Javis is an independent macOS computer-use runtime for local agents. It reads app accessibility trees, captures window screenshots, and performs element or coordinate actions. It provides a CLI, an MCP stdio server, and an Agent Skill. No Orca process or files are required after building the project.

Project references: [design](docs/design.md) · [architecture](docs/architecture.md) · [CLI and MCP protocol](docs/protocol.md) · [testing](docs/testing.md) · [operations](docs/operations.md) · [agent instructions](AGENTS.md).

## Requirements

- Apple Silicon Mac running macOS 14 or newer.
- Swift 6 and Xcode command line tools.
- Node 22 or newer for build scripts, plus an arm64 Node 24 or newer binary to bundle. Set `JAVIS_NODE_PATH` to select one explicitly. The installed app bundles its own runtime.
- An Apple Development signing identity for the local install.

## Build and install

```bash
npm ci
npm run typecheck
npm test
swift test --package-path native/javis-macos
npm run build
npm run install:local
```

The installer copies `Javis.app` to `~/Applications` and creates `~/.local/bin/javis`. Add `~/.local/bin` to your shell `PATH` if needed. Build and installation use only this repository and standard toolchains.

Check and grant the macOS permissions to **Javis**:

```bash
javis permissions status --json
javis permissions open
```

Accessibility is needed for app trees and actions. Screen Recording is needed for screenshots; `--no-screenshot` works without it. The permission window belongs to the signed `com.royran.javis` app.

## Agent setup

After installation, register both agents explicitly:

```bash
javis agent install all
```

This installs the Javis Skill and a user-level MCP stdio registration for Codex and Claude Code. You can register one at a time with `javis agent install codex` or `javis agent install claude`. The installer refuses to overwrite an edited skill or an unrelated registration with the same name.

## CLI workflow

```bash
javis list-apps --json
javis get-app-state --app com.apple.finder --json
javis click --app com.apple.finder --session <result.sessionId> --element-index 42 --json
```

An observation returns a session ID. Every action requires that ID so multiple agents cannot mix cached element indexes. Actions return a fresh snapshot and normally a compact tree diff. `--full-tree` returns the complete tree. Screenshots are saved to a private temporary file in CLI JSON output. MCP returns screenshots as image content.

The default macOS input path targets the app in the background. `--restore-window` explicitly brings it forward when an app cannot accept background input. Inspect `action.verification` and the returned snapshot before assuming an action succeeded. The Javis Skill contains the full agent workflow and safety guidance.

When an action is delivered but the app closes or cannot be observed afterwards, Javis returns `result.observationError` with the action metadata and no snapshot. Reobserve before deciding what happened; do not repeat the action from that result.

## Project boundaries

The Swift helper owns macOS accessibility, screenshot capture, input delivery, and the system permission UI. A private Unix socket connects it to the on-demand Javis daemon, which retains short-lived snapshots for the CLI and MCP connections. No network port is opened. `javis daemon stop` shuts down the daemon and helper.

The native implementation originated in the MIT-licensed Orca Computer Use project. The original copyright and permission notice are preserved in [LICENSE](LICENSE).

If Javis is killed during the brief daemon lock recovery step, a stale `~/Library/Application Support/Javis/daemon.lock.recovery` directory can prevent the next startup. Confirm no Javis daemon is running before removing that directory, then retry the command.
