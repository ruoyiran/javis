# Javis Mobile Browser CUA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a paired phone browser observe and operate the desktop served by a standalone Javis installation.

**Architecture:** A separate HTTPS gateway authenticates devices, owns their Javis sessions, and calls the ordinary local daemon. A responsive static page performs observe → act → observe without retrying uncertain actions.

**Tech Stack:** Node 22+ `https`/`http`, TypeScript, plain HTML/CSS/JavaScript, Javis runtime contract.

**Spec:** `docs/superpowers/specs/2026-11-16-javis-mobile-cua-design.md`

## Global Constraints

- Never expose the native helper or private daemon socket on a network interface.
- Require TLS for non-loopback binds; use a one-time pairing code and per-device session cookie.
- Require same-origin and CSRF headers for actions; do not log screenshots, trees, or input text.
- Never retry an action after a disconnect, timeout, or delivered-action observation failure.
- GUI mutation tests run only on isolated desktop fixtures.

---

### Task 1: Authenticated gateway

**Files:** Create `src/mobile/gateway.ts`, `src/mobile/pairing.ts`, `tests/mobile/gateway.test.ts`.

**Interfaces:** `startMobileGateway(options:{bind:string;port:number;cert?:string;key?:string;call:(method:JavisMethod,params:Record<string,unknown>)=>Promise<unknown>}):Promise<{url:string;pairingCode:string;close:()=>Promise<void>}>`.

- [ ] Write failing HTTP tests for `/api/apps` returning 401 before pair, `/api/pair` consuming a code exactly once, and `/api/action` returning 403 without a matching Origin/CSRF header. Run `npm test -- tests/mobile/gateway.test.ts` and verify failures.
- [ ] Implement separate HTTP loopback and HTTPS LAN binding; reject non-loopback without both PEM files. Generate a 128-bit random pairing code valid for five minutes, limit failed attempts to five per minute per remote address, and issue a 256-bit random `HttpOnly; Secure; SameSite=Strict` session cookie. Reject unpaired requests and purge expired device sessions.
- [ ] Serve fixed page assets with a restrictive CSP and no-store headers. Test wrong host header, bad origin, malformed body, oversized body, repeated pairing code, and missing cookie. Run `npm test -- tests/mobile/gateway.test.ts && npm run typecheck`.

### Task 2: CUA session and action API

**Files:** Modify `src/mobile/gateway.ts`; create `src/mobile/device-session.ts`, `src/mobile/coordinates.ts`; test `tests/mobile/device-session.test.ts`, `tests/mobile/coordinates.test.ts`.

**Interfaces:** `DeviceSession` stores `{app,windowId?,windowIndex?,sessionId,observedAt,requiresRefresh}` per cookie. `imagePointToWindowPoint({clientX,clientY,rectWidth,rectHeight,imageWidth,imageHeight,scale})` returns `{x,y}`.

- [ ] Write failing tests showing a device cannot act without its own observation or borrow another device's session, and a delivered `observationError` blocks its next action. Write a scale fixture: a 400px displayed image representing an 800px screenshot at scale 2 maps tap x=100 to window x=100.
- [ ] Implement `listApps`, `listWindows`, `getAppState` and the nine action methods through `callJavis`. Store session IDs only server-side and validate app/window/index/coordinate fields before sending. Use one action queue per device and never retry a failed request.
- [ ] Return action metadata and screenshot bytes in authenticated JSON, without writing public files. Run `npm test -- tests/mobile/device-session.test.ts tests/mobile/coordinates.test.ts tests/mobile/gateway.test.ts`.

### Task 3: Phone page and CLI entry

**Files:** Create `src/mobile/page.ts`; modify `src/cli.ts`; test `tests/mobile/page.test.ts`, `tests/cli/mobile-command.test.ts`.

- [ ] Write failing tests that the page contains app/window selectors, screenshot, accessible tree, controls for all nine actions, foreground toggle, and a warning state for uncertain delivery. Test CLI refuses a LAN bind without certificate/key.
- [ ] Implement responsive page JS: enter pairing code; list apps/windows; observe; tap screenshot with coordinate conversion; run each action once; render returned tree/image; disable actions after `observationError` or transport uncertainty until Refresh. Do not persist images or typed text in browser storage.
- [ ] Add `javis mobile serve` with bind/port/cert/key flags. Print URL and pairing code to the invoking terminal; do not open a desktop window. Document certificate preparation and phone smoke test in `docs/operations.md` and `docs/testing.md`.
- [ ] Run `npm run typecheck`, `npm test`, `npm run build:js`, and `git diff --check`; commit with `git add src/mobile src/cli.ts tests/mobile docs && git commit -m 'feat: add paired mobile browser CUA'`.
