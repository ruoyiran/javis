# Testing Javis

## Automated checks

Run from the Javis repository root:

```bash
npm ci
npm run typecheck
npm test
swift test --package-path native/javis-macos
npm run build
codesign --verify --deep --strict build/Javis.app
git diff --check
```

`npm test` runs the TypeScript CLI, MCP, permission, session, transport, daemon-lock, helper-startup, and installer tests. `swift test` covers native authorization, input event construction, stable indexes, value conversion, request-loop ownership, and delivered-action observation failures. `npm run build` bundles JavaScript, compiles the Swift helper, assembles the app with its Node runtime and license notices, and signs it. An Apple Development signing identity is needed for the local app build.

Tests should assert observable behavior and hard-coded expected results. Add a regression test when changing session isolation, socket framing, peer authentication, delivery, action verification, permission status, or install safety. Keep tests at the owning layer. Avoid tests that merely inspect source text, formatting, copies, constants, or framework behavior.

## Independence check

Build from a clean copy outside this repository; do not include local build artifacts or `node_modules`:

```bash
check_dir=$(mktemp -d)
rsync -a --exclude=.git --exclude=node_modules --exclude=build --exclude=dist --exclude=.build ./ "$check_dir/"
(cd "$check_dir" && npm ci && npm test && npm run typecheck && npm run build)
```

The copy must resolve its own source and packages; verify that `src/`, `native/`, and `scripts/` contain no `@orca/*` imports or absolute path to an Orca checkout. The original checkout need not be present to run the copied project. `JAVIS_NODE_PATH` may identify an arm64 Node 24+ binary if the package script cannot find one on `PATH`.

## Installed, read-only smoke check

After `npm run install:local` and a user-granted macOS permission setup:

```bash
javis permissions status --json
javis capabilities --json
javis get-app-state --app com.apple.finder --json
javis daemon stop
codex mcp get javis
claude mcp get javis
```

Confirm both permissions are granted, a snapshot has a `sessionId` and nonempty accessibility tree, screenshot status is `captured` when requested, and its temporary file is mode `0600`. MCP validation should list 14 tools and call `javis_get_app_state` in a read-only session; the response should contain text and an image block. Do not print private tree text or screenshot bytes in test logs. Verify that daemon stop leaves no Javis helper process.

## Mutable desktop checks

Clicks, typing, drags, foreground restoration, permission UI, and tests involving native focus must run in an isolated macOS graphical login session or CI fixture. Never use the user's active desktop as a mutable test target. Exercise a disposable app window and verify semantic actions, background focus preservation, explicit `restoreWindow`, screenshot scale and coordinates, stale-index rejection, protected-app refusal, and the post-action `observationError` case. The automated suites and read-only smoke check do not prove every third-party app accepts synthetic background input; `background_unavailable` remains a supported outcome.
