# Orca browser and desktop CUA latest parity

Approved implementation plan: migrate the 83 browser commands and 16 desktop CUA commands from Orca `d3a843d032f602cf09e392613683a94089efce07` into Javis starting at `b5c1080`. Original migration ancestor: Orca `729f757b592244176420a86114c1ea23911eeeba`.

## Global constraints

- Work in the user-requested Javis checkout on `feat/orca-browser-cua-latest-parity`; update Orca to the approved reference commit and otherwise treat it as read-only.
- Javis owns all source, build resources, native providers, transport and persistent state; no sibling checkout or `@orca/*` runtime/build dependencies.
- Preserve Javis authentication, signed identity, secure-field redaction, host/context isolation and delivered-action observation errors. Never replay uncertain input.
- Browser-only Electron remains independent of native desktop CUA. Hidden browser checks use `ORCA_BACKGROUND_LAUNCH=1`; mutable desktop tests require isolated graphical sessions.
- Preserve existing CLI namespaces and flat CUA aliases, result envelopes, SSH `--host` routing and persisted profile/session data.
- Inventory coverage and real behavior evidence are separate. Platform checks not run must not be reported as passed.

## Task 1: Native CUA and shared provider contract

Migrate launchApp, subtree observations, typed element input, disabled element state, PNG/JPEG scale/edge control and system-shortcut policy into the existing macOS/Linux/Windows providers and shared CUA contract. Launch reports actual app/launched/delivery; already-running apps receive no reopen or activation. Linux launch remains unsupported. Provider capabilities must reflect actual support. Subtrees resolve existing caller/window indexes and preserve scoped caches. Inputs delivered before observation failure retain action/verification/observationError.

## Task 2: Browser source delta and runtime

Three-way migrate original ancestor, current Javis and fixed latest Orca source. Cover all 83 commands and 101 browser methods, including browser.stop, browser.zoom, browser.clientPage.initializationAction and browser.clientHost.commandResultChunk. Migrate required engine/preload/renderer/client-host/session/stream deltas and their locally owned dependencies. Preserve Javis source-ready authority checks and lifecycle fixes. Electron 43.8.10 and agent-browser ~0.43.0 must ship together with matching resources and binaries.

## Task 3: Public adapters

Browser fill --value-stdin excludes --value, trims one final LF/CRLF, rejects empty stdin, and supports explicit empty --value. Tab create --headless requests server placement. CUA adds launch-app with positional/--app and --activate; shared adapter wait polls existing read interfaces without a new daemon/SSH wait RPC or holding the daemon action queue. Exactly one text/enabled/window-title condition; case-insensitive matching; enabled requires reported disabled state and all matching elements enabled; default 10000 ms, maximum 120000 ms; window-title excludes window selectors; timeout code wait_timeout.

Get-app-state --element-index maps to rootElementIndex and verifies returned scope. Type-text element targets require provider capability. Observation/action screenshot flags are screenshot-format png|jpeg, positive finite screenshot-scale and positive integer screenshot-max-edge. Press-key/hotkey support explicit allow-system-shortcut. MCP adds javis_launch_app and javis_wait; all adapters share validation and semantics. CLI file extensions, MCP MIME and phone CUA display honor screenshot format.

## Task 4: Verification and reference records

Retain fixed per-command/parameter/method/platform matrix. Meaningful regression cases exercise missing behavior at its owning layer with independently fixed expected values. Run TS gates, unit/protocol tests, Swift/Python checks, build and strict signatures. Exercise real hidden browser commands, standalone packaging, restored state, remote host streams and action cancellation. Real native focus/permissions require OS-specific isolated graphical environments. Build and check a cold independent source copy. Update protocol, skills and verification records. Do not install or change Agent user configuration as part of these source/build steps.
