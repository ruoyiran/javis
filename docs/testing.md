# Testing Javis

## Automated checks

From the Javis repository root:

```bash
npm ci
npm run typecheck
npm test
python3 -m unittest discover -s native/javis-linux -p '*test.py'
npm run build
git diff --check
```

`npm test` covers the shared contract, CLI, MCP, session isolation, SSH framing and routing, provider selection, helper lifecycle, settings requests, and loopback mobile gateway with fake Javis calls. Linux Python unit tests use fake GI objects and can run on macOS or Linux; they do not prove a real AT-SPI desktop session. Tests should assert observable behavior with hard-coded expected results at the owning layer, not mirror source text or copy translations.

Command parity tests exercise every Orca computer command through the namespaced Javis parser, existing aliases, inline value flags, stdin validation, tree query semantics and human output. MCP tests cover full-tree controls, action validation and truthful discovery inputs. Runtime tests verify rejection before provider delivery and invalidation after failed observation. The reference and complete command mapping are recorded in [Orca CUA parity](orca-cua-parity.md).

Run npm with a normal development Node executable. A hardened app-bundled Node can reject npm native bindings with a macOS Team ID mismatch, surfaced by Vitest as a missing rolldown binding. Select the development Node through `PATH` before running npm; on this Homebrew host, `PATH=/opt/homebrew/bin:$PATH npm test` uses Node 22. Do not re-sign dependencies or disable library validation to run tests.

On a macOS build host with an Apple Development identity, also run:

```bash
swift test --package-path native/javis-macos
npm run build
codesign --verify --deep --strict build/Javis.app
```

The app build compiles and signs the Swift helper, bundles Node, and assembles the installer input. The signature and macOS permission identity require macOS verification.

After a branding or release-version change, check that `build/Javis.app/Contents/Resources/Javis.icns` matches `assets/branding/Javis.icns`, the app's `CFBundleIconFile` is `Javis`, and both bundle version fields match `package.json`. The packaged CLI's `--version` and the MCP initialization response must report the same version. Branding tests also exercise real settings/mobile HTML responses and an isolated JavaScript-build fixture, without opening desktop apps or permissions UI.

On Windows CI or a Windows desktop test machine, run the TypeScript checks and PowerShell provider test with Windows PowerShell 5.1, then exercise the actual UI Automation provider in an isolated interactive graphical login. `npm run build` and `npm run install:local` create the user-local Windows launcher, which references the install-time Node executable by absolute path. For example:

```powershell
powershell.exe -NoProfile -NonInteractive -File native/javis-windows/runtime-pointer.test.ps1
```

The PowerShell test and a real Windows GUI smoke check cannot be replaced by a macOS run. Verify the persistent `-Serve` host, one-shot fallback, timeout reaping, and capability gating on Windows itself.

## Independence check

Build from a clean copy outside this repository, without local build artifacts or `node_modules`:

```bash
check_dir=$(mktemp -d)
rsync -a --exclude=.git --exclude=node_modules --exclude=build --exclude=dist --exclude=.build ./ "$check_dir/"
(cd "$check_dir" && npm ci && npm test && npm run typecheck && npm run build)
```

The copied project must resolve its own source and packages. Verify `src/`, `native/`, and `scripts/` contain no `@orca/*` imports or absolute path to an Orca checkout. On macOS with signing available, run the full app build in the clean copy too. The sibling Orca checkout need not exist.

## Read-only desktop smoke checks

Use an existing window only with task authorization. On macOS after local installation and user-granted permissions:

```bash
javis permissions status --json
javis capabilities --json
javis list-windows --app com.apple.Terminal --json
javis get-app-state --app com.apple.Terminal --json
javis daemon stop
```

Check that the snapshot has a session/context and nonempty tree, and that a requested image is captured or has a truthful failure status. Check private screenshot file permissions when a file is produced. The MCP server should expose 14 tools, return JSON text for `javis_get_app_state`, and add an image block when capture succeeds. Do not print private trees or image bytes in test logs. Verify daemon shutdown leaves no helper child.

Choose an app that actually has a visible top-level window. Finder's desktop background does not count; when `list-windows` returns zero, open a Finder window manually or use another app for the read-only check.

On Linux, use a graphical login with Python 3, PyGObject/AT-SPI, and an existing permitted app window. Check `javis capabilities --json` first; screenshot, hotkey, paste, and window-ID support vary with X11/Wayland and installed tools. On Windows, use the user's interactive desktop and PowerShell UI Automation; verify capabilities and a read-only window snapshot there. A headless build is not a GUI smoke check.

For an independent remote host, run `javis capabilities --host <SSH-alias> --json` and a read-only `get-app-state` call using the same explicit host. Verify SSH host checking, session isolation between local/remote and worktree/folder contexts, and that a remote screenshot path is materialized only on the caller. Disconnect and timeout tests must confirm that actions are never automatically resent.

## Mobile and mutable checks

The loopback gateway tests cover one-time pairing, unauthenticated and CSRF denial, per-device target/session isolation, action allowlisting, coordinate conversion, and no retry after an ambiguous failure. A manual phone smoke check needs a private LAN or tunnel, a trusted or accepted HTTPS certificate, and the gateway running on the desktop host. Confirm the five-minute pairing flow, app/window selection, image scaling, and refresh requirement after uncertain delivery. The page cannot control phone apps.

Clicks, typing, drags, focus changes, native permission UI, and foreground restoration belong in an isolated graphical login or CI fixture on the relevant OS. Never use the user's active desktop as a mutable test target. Exercise a disposable window, stale-index rejection, protected-app refusal, background focus preservation where supported, explicit `restoreWindow`, and the delivered-action `observationError` case. The automated suites and read-only smoke check do not prove every third-party app accepts background synthetic input.
