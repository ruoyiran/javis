# Orca Browser Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement the tasks. Read the assigned task brief and its interfaces; do not spawn your own workers or reviewers.

**Goal:** Implement the approved complete Orca browser snapshot in standalone Javis, including desktop UI, automation, profiles, extensions/passwords, remote/mobile routing, and packaging.

**Architecture:** Add an independently launched Electron browser service beside the native CUA provider. Copy upstream browser implementation and its required dependency closure into Javis-owned source, adapting only host/context, application identity, storage and transport boundaries. CLI, MCP, SSH and paired mobile consume the same browser service.

**Tech Stack:** Node 22+, TypeScript, Electron 43.8.6, React/ReactDOM ~19.2.8, agent-browser ~0.39.4, existing Javis MCP SDK/Zod and native CUA providers.

**Spec:** `docs/superpowers/specs/2026-11-19-orca-browser-parity-design.md`

## Global Constraints

- Source snapshot: Orca `729f757b592244176420a86114c1ea23911eeeba`; fixed inventory: `docs/browser-parity/orca-729f757-baseline.json`.
- All writes belong to `/Users/bytedance/workspace/github/javis`; source Orca is read-only.
- No installed/runtime/build dependency on Orca checkout, Orca RPC service, or `@orca/*` packages.
- Preserve the existing signed Swift CUA helper and native input policy. User explicitly approved browser-only Electron.
- No unsupported placeholders count as parity. Each upstream browser feature requires its real implementation and dependencies.
- Do not install the app or modify user Agent registrations; building and background checks are authorized.
- Tests and launched apps use `ORCA_BACKGROUND_LAUNCH=1`. Hidden renderer/CDP checks never show/focus windows; desktop mutations run only on isolated displays/CI.
- Relevant behavior tests use fixed expected results in the owning layer. Do not add tests for translation copy, CSS classes, private state, third-party implementations, timing or work counts.
- Browser UI uses migrated Orca tokens/primitives; Javis identity replaces Orca product identity.
- Changes in the same working tree use explicit file ownership. Controller owns root runtime integration, dependencies, build/packaging and docs.

## Files and Interfaces

Upstream code retains its relative main/preload/shared/renderer layout under `src/browser/source/`. Main/shared/preload and renderer have separate owners; renderer dependencies on shared modules are read-only to its owner. Source extraction extends beyond inventory seeds whenever an import requires it. Non-browser host dependencies must receive real Javis adapters; do not swallow calls with no-ops.

```ts
export type BrowserCallParams = Record<string, unknown>
export type BrowserCall = (method: string, params: BrowserCallParams) => Promise<unknown>
export type BrowserService = {
  call: BrowserCall
  shutdown(): Promise<void>
}
export type BrowserServiceOptions = {
  dataDirectory: string
  background: boolean
  emit(event: { method: string; params: Record<string, unknown> }): void
}
```

The engine produces `createBrowserService(options: BrowserServiceOptions): Promise<BrowserService>` in `src/browser/main/browser-service.ts`. Its Electron entry is `src/browser/main/main.ts`. The controller produces `callBrowser(method, params, target?)` and `stopBrowserProcess()` in `src/browser/runtime/browser-process.ts`; `target` contains optional `host/context`. The CLI worker consumes a supplied `BrowserCall`, so it is independently testable before process integration. The renderer receives migrated Electron preload/API via its own app bootstrap.

### Task 1: Browser engine, shared contracts and preload

**Files:** Create `src/browser/source/main/`, `src/browser/source/shared/`, `src/browser/source/preload/`, `src/browser/main/browser-service.ts`, `src/browser/main/main.ts`; tests under `tests/browser/engine/`. Do not edit `src/browser/source/renderer/`, root runtime, root package/build files or worker adapter directories.

**Consumes:** Approved spec, immutable inventory, existing Javis error/host/context behavior.

**Produces:** Real browser engine and the `createBrowserService` interface above, dependency list and source migration report. Shared source is exposed with original relative paths under `src/browser/source/shared/`.

- [ ] Trace and copy browser manager, backend, agent-browser/CDP, guest lifecycle, extension/password/session/site/cookie/download/network/grab and headless implementations; include required shared/preload modules and locally owned process-host code.
- [ ] Port existing meaningful source tests for page targeting, URL guard, dialog and input behavior into Javis's test layer and observe missing-feature failures before adapters. Use original fixed expected values.
- [ ] Implement service dispatch over the migrated engine, all source browser methods, tab/profile persistence, real Electron guest registration, and meaningful owner/context adapters.
- [ ] Adapt imports to Javis-local modules and storage/identity, resolving every build import. Report required external dependencies and entry points in the report file, never installing in root concurrently.
- [ ] Verify source dependency resolution and scoped tests; engine must retain full upstream browser behavior, including extensions and password modules.

### Task 2: Browser renderer and UI host adapters

**Files:** Create `src/browser/source/renderer/`, `src/browser/renderer/`, `tests/browser/renderer/`. Do not edit source main/shared/preload, root packages/runtime or CLI/MCP adapter directories.

**Consumes:** Migrated shared/preload source paths from Task 1; approved UI rules and source snapshot.

**Produces:** Browser renderer entry `src/browser/renderer/main.tsx`, HTML entry `src/browser/renderer/index.html`, and standalone browser workspace rendering with functional host/context adapters.

- [ ] Extract browser-pane, browser settings, store/navigation, required UI primitives, CSS tokens, i18n/assets and their renderer dependency closure, maintaining upstream behavior.
- [ ] Implement actual workspace/page/layout/bootstrap adapters for Javis context rather than creating a visually approximate toolbar. Preserve split/floating/popups, history, prompts, DevTools, profiles/extensions/password settings, grab/annotation/document surfaces and remote stream surfaces.
- [ ] Retain original preload API shapes. Write a concrete dependency/bootstrap report describing root integration needed; shared source modifications go through controller/engine owner.
- [ ] Build renderer independently with external package resolution, verify the app root can render actual source browser components, and run meaningful existing component behavior tests.
- [ ] Provide reproducible viewport/theme/fixture state for hidden-renderer screenshots after Task 4 connects the process.

### Task 3: Complete CLI/MCP command adapters and validation

**Files:** Create `src/browser/cli/`, `src/browser/contract/`, `src/browser/mcp/`, `tests/browser/cli/`, `tests/browser/contract/`. Do not edit root CLI/MCP/runtime, root dependencies or source trees.

**Consumes:** Fixed 83-command/97-method inventory and actual Orca CLI handlers/specs/schemas. A `BrowserCall` function is injected.

**Produces:** `runBrowserCli(argv, deps): Promise<number>` with `deps.call`, `stdout`, `stderr`, `cwd`; browser MCP tool registration function and validated browser method/catalog exports.

- [ ] Write failing behavior tests with fixed arguments and expected RPC requests, including page/expectUrl, profile operations, empty field values, malformed flags and unchanged computer-command semantics.
- [ ] Migrate typed command parsing/handlers/specs and shared validation rather than inventing a partial generic flag parser. Map all source command groups, removing only the duplicated leading `browser` for identity commands.
- [ ] Preserve source result payload and Javis error envelope; screenshot output uses private local image files. Use namespace `javis browser`, retaining existing native computer commands.
- [ ] Expose source public browser methods through MCP with the same validation; do not expose internal client-host/control methods as arbitrary Agent tools.
- [ ] Verify complete command coverage against fixed inventory and scoped behavior tests. Return explicit integration calls and dependency requirements to controller.

### Task 4: Private process, daemon/CLI/MCP integration and browser build

**Files:** Create `src/browser/runtime/browser-process.ts`, `src/browser/runtime/browser-channel.ts`, `scripts/build-browser.mjs`; modify `src/runtime/public.ts`, `src/runtime/daemon-dispatch.ts`, `src/runtime/target-router.ts`, `src/cli.ts`, `src/cli/run-cli.ts`, `src/mcp/server.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `scripts/build-js.mjs`, `scripts/build.mjs`.

**Consumes:** Service, renderer and command adapters from Tasks 1–3.

**Produces:** Independent packaged browser assets, authenticated same-user channel, connected browser CLI/MCP and daemon lifecycle.

- [ ] Add a real private-channel fixture test that rejects the wrong token and preserves a delivered result/error across disconnect without replay; observe its failure before channel implementation.
- [ ] Launch browser with private IPC and Javis data directory; correlate requests/events and close/reap only owned browser generations. Requests default to background; explicit open shows the workspace.
- [ ] Route browser methods separately from native computer validation and preserve existing CUA dispatch.
- [ ] Add root CLI/MCP dispatch to the adapter worker's entry points, including browser open/status and valid help.
- [ ] Add pinned dependencies required by extracted imports and independent browser build entries; all source/runtime paths resolve inside Javis.
- [ ] Run `ORCA_BACKGROUND_LAUNCH=1 npm run typecheck`, `npm test`, JS/browser builds and hidden Electron fixtures with no native desktop mutation.

### Task 5: Remote, mobile, placement and stream integration

**Files:** Modify `src/runtime/remote-stdio.ts`, `src/mobile/gateway.ts`, `src/mobile/device-session.ts`, `src/mobile/page.ts`; create `src/browser/remote/` and relevant tests.

**Consumes:** Migrated source client-host/owner/network/screencast/file-transfer contracts and connected service.

**Produces:** Browser SSH calls, persistent event/stream channel, paired mobile browser page actions, client/server placement and truthful recovery behavior.

- [ ] Port meaningful browser routing/owner/stream source fixtures with fixed expected placement and results; test owner loss, cancellation and reconnect at the routing layer.
- [ ] Extend one-request SSH allowlist for browser RPC; persistent stream/control/file chunks use a separate framed authenticated channel with bounded frames and subscription teardown.
- [ ] Connect source client-hosted/server-hosted page logic to Javis host/context and preserve independent server page operation and client-offline errors.
- [ ] Extend paired mobile UI with source browser stream/controller, storing page/profile/session on the device server-side; use existing pairing/CSRF and fresh observation after ambiguous actions.
- [ ] Verify local/remote isolation, browser network execution position, stream ack/backpressure, file transfer paths, offline recovery and mobile coexistence with existing CUA.

### Task 6: Packaging and full compatibility verification

**Files:** Modify `scripts/package-macos.mjs`, install/build packaging scripts, `docs/design.md`, `docs/architecture.md`, `docs/protocol.md`, `docs/testing.md`, `docs/operations.md`, `README.md`, `skills/javis/SKILL.md`; create browser parity report and isolated platform verification fixtures.

**Consumes:** Complete implementation and evidence from Tasks 1–5.

**Produces:** Browser included in macOS/Linux/Windows distribution, independent source/build/runtime, public documentation and explicit parity evidence.

- [ ] Package signed `com.royran.javis.browser` separately inside the existing Javis distribution, sign nested helpers/frameworks in order and retain existing Swift app identity; include browser resources on Linux/Windows.
- [ ] Build a clean independent copy without sibling Orca references and scan production/build imports for `@orca/*` and forbidden runtime paths.
- [ ] Run full TypeScript/typecheck/browser builds, Swift tests, Python provider tests and signed macOS verification; add isolated platform jobs/fixtures where local graphical platforms are unavailable.
- [ ] Compare complete fixed CLI/RPC inventory, real engine behavior and desktop renderer states; identify any missing feature rather than claiming parity from method counts.
- [ ] Update skills/docs around final supported behavior and test evidence. Do not claim Windows/Linux GUI parity from macOS runs.
- [ ] Review whole change, repair concrete findings, inspect `git diff --check`, verify Orca tree untouched and report final implementation plus actual validation limits.
