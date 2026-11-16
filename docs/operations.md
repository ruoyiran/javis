# Local build and operations

## Build, sign, and install

Javis 0.1 builds on Apple Silicon for macOS 14+. Install Xcode command line tools, Swift 6, npm with Node 22+, and an arm64 Node 24+ executable. The packaging script selects an eligible Node on `PATH`; set `JAVIS_NODE_PATH` to choose one explicitly. Set `JAVIS_SIGN_IDENTITY` to override the first Apple Development certificate found by `security find-identity`.

```bash
npm ci
npm run build
npm run install:local
```

The bundle is signed as `com.royran.javis`. The installer verifies the new signature, checks any existing `~/Applications/Javis.app` before replacement, stops the daemon, installs the signed app, and writes `~/.local/bin/javis`. It refuses an unrelated existing app or launcher. Repeating the install retains the app identity needed for macOS privacy grants. The installed app includes its Node runtime and dependency license notices; npm and Orca are not needed to run it.

## Permissions and agents

```bash
javis permissions status --json
javis permissions open
javis agent install all
```

The first permission is Accessibility, used for UI trees and actions. Screen Recording permits window PNGs; `--no-screenshot` still permits tree-only observations when capture is unavailable. Only the user can grant the macOS permissions. The helper is launched through LaunchServices so its signed app identity receives those grants. Normal observations do not open the permission UI.

The separate Agent command installs a Javis Skill and a user-level stdio MCP registration for Codex and Claude Code. It can be scoped to either agent. It updates previously managed Skill copies, refuses user edits and unsafe links, and does not replace a different MCP registration named `javis`.

## Diagnosis and cleanup

Use `javis capabilities --json` to check helper availability and `javis permissions status --json` for TCC grants. `permission_denied` points to missing macOS authorization; `background_unavailable` means the target cannot accept that background route and `restoreWindow` would deliberately take focus. `element_not_found` or `window_stale` calls for a new observation. A timeout or `observationError` after delivery requires inspection before any retry.

`javis daemon stop` closes the private socket and reaps the helper. Its state lives in `~/Library/Application Support/Javis`; CLI screenshots live in a private temporary directory and expire after 24 hours. If a process is killed during the brief daemon lock recovery critical section, `daemon.lock.recovery` can remain and startup fails closed. Confirm no Javis daemon is running before removing that stale guard, then retry. Do not remove an active daemon's socket or lock.
