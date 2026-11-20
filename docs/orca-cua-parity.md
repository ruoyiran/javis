# Orca CUA command parity

Latest browser/CUA synchronization is pinned to Orca `d3a843d032f602cf09e392613683a94089efce07` (83 browser commands,16 desktop CUA commands). See [latest command parity](browser-parity/latest-command-parity.md) and its fixed parameter/method inventory. Earlier verification records below retain their original snapshot/evidence.

The comparison uses Orca commit `729f757b592244176420a86114c1ea23911eeeba`. Its `src/cli/specs/computer.ts` declares 14 CLI commands: 13 computer operations and permission setup. Each has a Javis command with the same action-specific flags. Both `javis computer <command>` and the existing flat Javis names use one parser and runtime.

## Command mapping

| Orca command | Javis command | Runtime operation |
| --- | --- | --- |
| `orca computer capabilities` | `javis computer capabilities` | `capabilities` |
| `orca computer list-apps` | `javis computer list-apps` | `listApps` |
| `orca computer permissions` | `javis computer permissions` / `javis permissions open` | `permissionsOpen` |
| `orca computer list-windows` | `javis computer list-windows` | `listWindows` |
| `orca computer get-app-state` | `javis computer get-app-state` | `getAppState` |
| `orca computer click` | `javis computer click` | `click` |
| `orca computer perform-secondary-action` | `javis computer perform-secondary-action` | `performSecondaryAction` |
| `orca computer scroll` | `javis computer scroll` | `scroll` |
| `orca computer drag` | `javis computer drag` | `drag` |
| `orca computer type-text` | `javis computer type-text` | `typeText` |
| `orca computer press-key` | `javis computer press-key` | `pressKey` |
| `orca computer hotkey` | `javis computer hotkey` | `hotkey` |
| `orca computer paste-text` | `javis computer paste-text` | `pasteText` |
| `orca computer set-value` | `javis computer set-value` | `setValue` |

Javis also supplies permission status/reset, local settings, Agent installation, explicit SSH stdio routing and a paired mobile page. Orca's terminal, worktree-management, embedded-browser and orchestration commands are separate product features; this matrix covers its desktop CUA command family.

## Parameters and output

The complete action flag table is in [protocol](protocol.md). Observation and actions share `--app`, `--session` or `--worktree`, `--window-id` or `--window-index`, `--restore-window`, `--no-screenshot`, and `--json`; actions additionally accept `--full-tree`. Observation supports `--query` and `--max-elements`. Literal text supports stdin, and `set-value` can clear a value with an empty string. Positive click counts and fractional positive scroll pages follow the Orca contract. Keys and click modifiers use the same shared chord specification.

Both spaced and `--flag=value` forms are supported, including values beginning with `--`. `--json` can precede the command. Use `javis computer --help` or `javis computer click --help` to inspect commands and flags without starting a desktop provider.

Human output shows app/window identity, screenshot geometry/scale/status, action delivery/verification, and a fresh-observation command carrying the same host/context. Query filters match element content without treating the numeric element label as content. Native indexes remain unchanged. JSON keeps Javis's `{ok,result}` / `{ok:false,error}` envelope and private local screenshot materialization.

MCP exposes the same nine actions. An action defaults to `treeDiff:true`; `fullTree:true` or `treeDiff:false` requests the full tree. Simultaneous `fullTree:true` and `treeDiff:true` is invalid. Observation accepts optional `treeDiff`. Input validation rejects malformed targeting, keys and modifiers before routing.

## Runtime and native evidence

| Layer | Evidence |
| --- | --- |
| Shared types, keys, tree rendering and action validation | Extracted modules match Orca apart from standalone imports and Javis's preserved delivered-action observation failure result. |
| macOS | All nine actions, discovery, capture, rendering, stable indexes, background input and permission helper are present in `native/javis-macos/`. Controller PID, same UID, trusted signed identity and one-time token remain Javis-specific. |
| Linux | Complete Python AT-SPI provider in `native/javis-linux/runtime.py`, including optional-tool capability detection, window-local coordinates and secure-field redaction. |
| Windows | Complete PowerShell UI Automation provider in `native/javis-windows/runtime.ps1`, including persistent hosting, pointer routes, capture and secure-field redaction. |
| Provider adapters | Action mapping, window/element caches, screenshot rendering, value verification and capability gates are retained. Javis additionally cancels delivery after caller loss and preserves delivered actions when observation fails. |
| Session owner | Direct calls validate app/window/boolean flags before provider delivery. Failed observations invalidate old indexes and tree baselines. Actions require fresh state in the same host/context. |

Normal observations do not activate a target app; `restoreWindow` explicitly opts into foreground restoration. Linux/Windows synthetic input remains subject to each provider's reported background support. An uncertain action is never automatically replayed.

Orca runtime/environment/socket selectors are replaced by Javis's explicit `--host <SSH-alias>` and private local daemon. The worktree value names a session context on that host. No source, build or runtime code depends on the Orca checkout.

## Validation boundaries

CLI, MCP and daemon tests use controlled results to exercise dispatch, validation, filtering and output. Swift tests cover native core behavior; Python tests use fake GI objects. The signed macOS app and a clean copy must build independently. Real Linux AT-SPI and Windows UI Automation require an isolated graphical login on those operating systems; unit tests on macOS do not establish that GUI behavior. See [testing](testing.md).


Verification on 2026-11-17:

| Check | Result |
| --- | --- |
| TypeScript typecheck and tests | 41 files / 276 tests passed. |
| Swift native core | 23 tests passed. |
| Python provider unit tests | 18 tests passed with fake GI objects. |
| macOS build and signature | Full build passed; `codesign --verify --deep --strict` passed for `build/Javis.app`. |
| Clean independent copy | Fresh dependencies, typecheck, all 276 tests, full signed build and signature check passed; 154 source/test files matched the working repository. Temporary copy was removed. |
| Diff and sibling checkout | `git diff --check` passed; Orca remained clean. |
| Real Linux/Windows GUI | Not run on this macOS session; requires the relevant isolated graphical host. |

No local installation, Agent configuration update, or active-desktop mutation was performed.
