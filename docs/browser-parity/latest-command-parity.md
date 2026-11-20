# Latest browser and desktop CUA command parity

Fixed primary source: Orca `d3a843d032f602cf09e392613683a94089efce07`, captured 2026-11-20. Original migration ancestor: `729f757b592244176420a86114c1ea23911eeeba`. The [fixed command/flag inventory](orca-d3a843d-baseline.json) records 83 browser CLI commands, 16 computer CLI commands and 101 browser schemas. Inventory coverage is separate from real behavioral and platform evidence.

## Entry points

Use `javis browser <command>` for all 83 browser commands and `javis computer <command>` for all 16 desktop CUA commands. Existing flat CUA commands remain aliases. Orca runtime/environment selectors are represented by Javis's `--host <SSH alias>` and session/worktree context; a context is a namespace on that host and can be an ordinary folder.

Browser additions include `fill --value-stdin` (one final LF/CRLF stripped; empty pipe and competing `--value` rejected) and `tab create --headless` (server placement). The browser engine/transport adds stop, zoom, client-page initialization and chunked command result delivery. Its 101 schemas comprise 89 public and 12 internal methods; client initialization and host authority methods are not general MCP tools. Browser automation uses Electron 43.8.10 and agent-browser ~0.43.0, packaged from its per-platform optional binary package.

## Desktop CUA additions

- `launch-app <name|bundle|path> [--activate]`: default background launch; already-running apps left unchanged; actual app/launched/delivery returned. macOS/Windows only, matching upstream support.
- `wait --app <app> (--text <text>|--enabled <text>|--window-title <text>) [--timeout <ms>]`: passive reads; case-insensitive matching; enabled requires disabled-state capability and every matching control enabled. Default10000ms, maximum120000ms, timeout code `wait_timeout`. Window-title conditions cannot include window-ID/index filters. No new provider/SSH wait RPC.
- `get-app-state --element-index <n>`: real root subtree from prior same app/window/context indexes. Result root marker, provider app/PID/window and actual returned scope are validated; old providers may not silently return a full window.
- `type-text --element-index <n>`: actual element typing, capability-gated; unavailable providers return an error rather than typing at current focus.
- Observation/action image controls: `--screenshot-format png|jpeg`, positive finite `--screenshot-scale`, positive integer `--screenshot-max-edge`. Actual dimensions and pixel-per-window-point scale returned; divide image coordinates by that scale. CLI file extension, MCP MIME and phone rendering honor the returned format.
- `press-key`/`hotkey --allow-system-shortcut`: explicit opt-in to the platform system shortcut policy.

MCP adds `javis_launch_app` and `javis_wait`. Screenshot options, `rootElementIndex` for state, `elementIndex` for typing and `allowSystemShortcut` are shared with the runtime. After an undelivered observation, deadline/disconnection or uncertain input, the addressed observation authority/tree baseline is invalidated; delivered action/verification/observationError metadata remains intact.

## Verification boundaries

Core/browserNode/browserWeb typechecks, independent native/renderer reviews, owning regression cases and hidden engine/renderer checks are recorded in the implementation verification report. Native focus/input/permission flows require an isolated graphical session on each OS. Fake-GI Python tests on macOS do not prove Linux AT-SPI/Wayland; Windows PowerShell protocol tests require Windows and use `native/javis-windows/runtime-protocol.test.ps1`. Loopback framed/SSH-wrapper/mobile fixtures establish transport behavior without claiming physical-phone/OpenSSH network verification.

## Current implementation checks

The local implementation has passed all three TypeScript gates, 85 JavaScript test files /414 cases,106 native runtime/contract cases,24 Swift cases and18 Python fake-GI cases. Independent native/renderer reviews found subtree provenance, Windows explicit-window and renderer checkpoint/initialization gaps; fixes were reviewed as addressed. Actual hidden browser checks verify a mounted guest, URL-guarded fill/click/eval with no renderer errors and no visible window. Extended engine acceptance and client-host integration are being completed separately; the final report will supersede these intermediate counts.
