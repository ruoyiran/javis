# Orca Computer Command Parity Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for runtime/integration work and superpowers:dispatching-parallel-agents for independent adapter/native tasks. Each behavior follows a failing-test → implementation → passing-test cycle.

**Goal:** Cover every current Orca computer command and its supported action parameters in independent Javis.

**Architecture:** Both CLI forms use one parser and runtime. MCP exposes the same action controls; the daemon validates targets and invalidates stale observation state. Native providers retain equivalent source without introducing sibling dependencies.

**Tech Stack:** Node 22+, TypeScript, Swift 6, Python 3, Windows PowerShell 5.1.

**Spec:** `docs/superpowers/specs/2026-11-17-orca-command-parity-design.md`

## Global constraints

- All edits stay in Javis; Orca is read-only.
- Preserve independent builds, authenticated private endpoints, redaction, explicit SSH routing, and session freshness.
- Never replay an uncertain action or use the active desktop as a mutable fixture.
- Do not install or modify user Agent configuration during source parity work.

## Task 1: CLI command and output coverage

Files: `src/cli.ts`, `src/cli/`, `tests/cli/`.

- [x] Test literal Orca command names under `javis computer`, permission setup/status, existing flat aliases, all action flags, invalid numeric/key/modifier input, tree queries and human output.
- [x] Run targeted CLI tests and confirm missing-command/behavior failures.
- [x] Route namespaced commands through the existing parser; render complete help and result metadata without raw action input; align query matching and validation.
- [x] Run `npm test -- tests/cli` and `npm run typecheck`.

## Task 2: MCP and runtime contract

Files: `src/mcp/`, `src/contract/`, `src/runtime/session.ts`, `src/runtime/computer-request-validation.ts`, `tests/mcp/`, `tests/contract/`, `tests/runtime/session.test.ts`.

- [x] Test MCP full-tree/tree-diff controls, positive click counts above three, malformed target/key rejection and truthful list-window inputs.
- [x] Test `getAppState` with simultaneous window selectors or non-boolean `restoreWindow` rejects before provider delivery, and failed observation invalidates an existing session.
- [x] Observe targeted failures, implement adapter controls and runtime validation, and clear the session plus baseline after observation failure.
- [x] Run the affected MCP/contract/runtime tests and typecheck.

## Task 3: Native evidence and integration

Files: native provider sources/tests only for demonstrated differences; `docs/orca-cua-parity.md`, `docs/protocol.md`, `docs/testing.md`, `docs/operations.md`, `README.md`.

- [x] Compare all native action, discovery, capture and rendering operations against the reference; record intentional standalone/security differences.
- [x] Align permission adapter setup status, completed/unsupported setup, latest pending selection, cancellation, and exact setup-helper replacement. Reproduce each gap with controlled process/clock tests before changing `src/permissions.ts` and daemon dispatch.
- [x] Run native unit suites and add a regression before any native behavior port.
- [x] Document the complete command mapping, supported flags, session and platform limits, and verification evidence.
- [x] Run `npm ci`, typecheck, full tests, Python tests, Swift tests, build/signature verification, independent-copy checks and `git diff --check`; verify Orca remains untouched.
