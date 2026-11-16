# Orca CUA Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Javis independently provide Orca's macOS, Linux, Windows, remote-runtime and workspace-context computer-use capabilities to Codex and Claude Code.

**Architecture:** Keep Javis CLI/MCP and the per-user daemon as the public boundary. Plug in one local provider for each OS; route remote calls through SSH to another installed Javis. Permission setup and settings use the local daemon/CLI, never the native helper socket directly.

**Tech Stack:** Node 22+, TypeScript, Swift 5.9, Python 3 with PyGObject/AT-SPI, Windows PowerShell 5.1/UI Automation, OpenSSH, MCP stdio.

**Spec:** `docs/superpowers/specs/2026-11-16-orca-cua-parity-design.md`

## Global Constraints

- Build and run without Orca source, packages, Electron or an Orca runtime.
- Do not retry an action after uncertain delivery; preserve `action` with `observationError` after delivered input.
- Never activate a GUI in automated desktop tests on the user's active session.
- Preserve private socket/pipe permissions, secure-value redaction, blocked apps, and screenshot byte limits.
- Keep platform capability declarations truthful; do not promise background input on Linux/Windows.

---

### Task 1: Provider boundary and macOS lifecycle

**Files:** Modify `src/runtime/public.ts`, `src/runtime/session.ts`; create `src/runtime/provider.ts`, `src/runtime/macos-provider.ts`; test `tests/runtime/macos-provider.test.ts`, `tests/runtime/session.test.ts`.

**Interfaces:** `JavisProvider.call(method:string, params:Record<string,unknown>):Promise<unknown>` and `JavisProvider.shutdown():Promise<void>`. `createMacOSProvider():JavisProvider` owns helper generations. `SessionRuntime` consumes `provider.call` and gates capabilities/actions.

- [ ] Write a failing fake-helper transport test that opens generation A, closes it, then asserts the next request uses a distinct `helper.sock` path and token and reaps A. Run `npm test -- tests/runtime/macos-provider.test.ts` and see the path-equality assertion fail against current behavior.
- [ ] Move macOS launch/handshake/request code from `public.ts` into `macos-provider.ts`. Create the private helper directory inside each generation, delete it on close/timeout/shutdown, and do not reuse a closed socket path. Preserve `JavisError('action_timeout', ...)` in request failures; timeout must destroy the socket and reap its helper before another send.
- [ ] Add a session regression: `getAppState` followed by a delivered `observationError` invalidates indexed actions until another successful observation. Store observed app/window with each session and reject a changed action target with `stale_snapshot`. Run `npm test -- tests/runtime/session.test.ts` red, implement, run green.
- [ ] Gate `listWindows` and each action against the handshake's `supports` flags. Check that the app executable exists before launching. Run `npm test -- tests/runtime/macos-provider.test.ts tests/runtime/session.test.ts && npm run typecheck`.
- [ ] Commit with `git add src/runtime tests/runtime && git commit -m 'fix: rotate macOS helper generations and guard sessions'`.

### Task 2: Linux and Windows desktop providers

**Files:** Create `native/javis-linux/runtime.py`, `native/javis-windows/runtime.ps1`, `src/runtime/desktop-script-provider/` with `client.ts`, `bridge.ts`, `protocol.ts`, `snapshot-cache.ts`, `snapshot-rendering.ts`, `action.ts`, `windows-host.ts`; modify `scripts/build-js.mjs` and platform install scripts; test `tests/runtime/desktop-script-provider.test.ts` and native script tests.

**Interfaces:** `createDesktopScriptProvider(platform:'linux'|'win32'):JavisProvider`. It consumes Orca's MIT bridge JSON shape with `tool`, `app`, `windowId`, `windowIndex`, element identity and action fields; it returns Javis's `ComputerSnapshotResult`/`ComputerActionResult`.

- [ ] Copy the two MIT-licensed provider scripts from the Orca source into Javis-owned native directories, keeping their redaction, blocked-app, screenshot and capability logic. Record original commit and license in `LICENSE`/operations docs.
- [ ] Write a failing adapter test with a fixed bridge reply whose tree, screenshot, window and action fields are hard-coded; assert the public result and stable element lookup. Run `npm test -- tests/runtime/desktop-script-provider.test.ts` red.
- [ ] Implement bridge invocation with `spawn/execFile` argument arrays (`shell:false`), a 30-second deadline, private request file, 20 MiB output cap, and typed error mapping. On Linux use `python3`; on Windows use a SystemRoot-derived absolute PowerShell path, `RemoteSigned` followed by `Bypass` only for execution-policy rejection. Never replay an action after an ambiguous child failure.
- [ ] Implement the 2-minute/32-snapshot cache and Node rendering/action verification using existing Javis contract modules. Gate actions from handshake capabilities. Support Windows `-Serve` ready/requestId protocol with request queue, 120-second idle shutdown and one-shot fallback after repeated startup failure.
- [ ] Connect provider selection in the daemon: macOS uses Swift, Linux/Windows use script adapters. Use OS-appropriate per-user state location and socket/pipe transport. Run native parser/unit checks, `npm test`, `npm run typecheck`, and platform CI where available.
- [ ] Commit with `git add native src/runtime scripts tests docs && git commit -m 'feat: add Linux and Windows CUA providers'`.

### Task 3: Remote host and workspace contexts

**Files:** Create `src/runtime/remote-stdio.ts`, `src/runtime/target-router.ts`, `src/runtime/workspace-context.ts`; modify `src/cli.ts`, `src/cli/parse-call.ts`, `src/cli/run-cli.ts`, `src/mcp/server.ts`; test `tests/runtime/remote-stdio.test.ts`, `tests/runtime/workspace-context.test.ts`, `tests/cli/parse-call.test.ts`.

**Interfaces:** `callTarget(method:JavisMethod, params:Record<string,unknown>, target:{host?:string; context?:string}):Promise<unknown>`. `javis rpc --stdio` reads exactly one JSONL request and returns one `{ok,result|error}` line. Target names are OpenSSH aliases; worktree is an opaque snapshot namespace and never selects a host.

- [ ] Write failing tests: `--host devbox` invokes `ssh -T devbox javis rpc --stdio` with a JSONL method request; invalid host names are rejected before spawn; a disconnect after an action returns delivery-uncertain error and does not spawn a second command.
- [ ] Implement remote stdio framing with a bounded response, 60-second deadline, no shell interpolation, `BatchMode=yes`, and inherited OpenSSH known-host validation. Remote `rpc --stdio` runs the normal local daemon method allowlist; it must reject `__shutdown`, permission UI opening, and unknown methods.
- [ ] Add explicit `--host`, `--worktree` and `--session` targeting, with `--worktree`/`--session` mutual exclusion. Without explicit context, derive a stable namespace from canonical `cwd`, including folder workspaces. Scope daemon sessions by host and context; never treat remote screenshot paths as local.
- [ ] Add optional MCP `host` and `worktree` arguments to observation/action tools. MCP sessions are keyed by host plus context. Run `npm test -- tests/runtime/remote-stdio.test.ts tests/runtime/workspace-context.test.ts tests/cli/parse-call.test.ts tests/mcp/server.test.ts && npm run typecheck`.
- [ ] Commit with `git add src tests docs && git commit -m 'feat: route CUA to independent remote Javis hosts'`.

### Task 4: Permission parity, settings, and Agent guidance

**Files:** Modify `src/permissions.ts`, `src/cli/run-cli.ts`, `src/mcp/server.ts`, `src/cli/screenshot-output.ts`, `skills/javis/SKILL.md`; create `src/settings/server.ts`, `src/settings/page.html`, `src/contract/computer-use-error-recovery.ts`; test permission, settings and MCP files.

**Interfaces:** `readJavisPermissionStatus`, `openJavisPermissions`, `resetJavisPermissions` share one paced status gate. `javis settings` serves a loopback, token-protected settings page with status/refresh/open/reset/agent setup. Non-macOS reports unsupported macOS permissions while retaining Agent setup.

- [ ] Write failing permission tests for two simultaneous status reads launching one helper, reset invalidating a cached grant, and timed-out probe cleanup. Write MCP/CLI tests for default action `treeDiff:true`, mutually exclusive `windowId`/`windowIndex`, and screenshot-file write failure retaining inline data.
- [ ] Implement status pacing/coalescing and setup launch limiting with monotonic time. `reset` invokes `/usr/bin/tccutil reset Accessibility com.royran.javis` and `reset ScreenCapture com.royran.javis`, cancels queued setup, invalidates status, and reads fresh state. Verify bundle ID from installed app before reset.
- [ ] Add loopback settings page with CSRF token and per-request origin check. It shows permission states, refresh/open/reset and Codex/Claude install status/actions. Settings mutating endpoints call the existing CLI/domain functions; no native socket is exposed.
- [ ] Map Orca computer-use error codes into next-step guidance; preserve code/message in JSON and MCP. Update Skill, CLI help and protocol/operations docs. Run `npm test && npm run typecheck && ORCA_BACKGROUND_LAUNCH=1 swift test --package-path native/javis-macos`.
- [ ] Commit with `git add src tests skills docs && git commit -m 'feat: complete permission and Agent settings parity'`.

### Task 5: Independence and release verification

**Files:** Modify `AGENTS.md`, `README.md`, `docs/design.md`, `docs/architecture.md`, `docs/protocol.md`, `docs/testing.md`, `docs/operations.md`, `docs/examples.md`, platform package/install scripts.

- [ ] Document exact platform support, dependencies, capability limits, remote host setup, worktree context semantics, macOS identity, permissions and rollback commands. Update `AGENTS.md` to remove its superseded macOS-only scope while preserving the no-Orca-dependency rule.
- [ ] Run `npm ci`, `npm run typecheck`, `npm test`, native unit suites, `npm run build`, `codesign --verify --deep --strict build/Javis.app`, and `git diff --check`. Run cross-platform CI/isolated desktop suites for Linux and Windows; report unavailable gates explicitly.
- [ ] Build from an `rsync` copy excluding `.git`, `node_modules`, `build`, `dist`, and `.build`; scan source/scripts for `@orca/*` imports or sibling checkout paths. Verify the Git branch and Orca tree remain clean.
- [ ] Commit documentation and verified build changes with `git add AGENTS.md README.md docs scripts && git commit -m 'docs: describe standalone cross-platform Javis'`.
