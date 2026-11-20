# Build and operations

## macOS build, sign, and install

Release `0.2.0` adopts the “协作之手” Javis logo. The canonical resources are in `assets/branding`: the app package copies `Javis.icns` and declares it in `CFBundleIconFile`, while the CLI bundle embeds the SVG for settings/mobile headers and favicons. Cross-platform builds copy all branding into `dist/branding`. The CLI, MCP server and macOS bundle read their release version from `package.json`.

The current app package targets arm64 and x64 macOS 14+; build on the target architecture to produce its architecture-specific app. Install Xcode command line tools, Swift 6, npm with Node 22+, and an architecture-matched Node 24+ executable. The packaging script selects an eligible Node on `PATH`; set `JAVIS_NODE_PATH` to choose one explicitly. Set `JAVIS_SIGN_IDENTITY` to override the first Apple Development certificate found by `security find-identity`.

```bash
npm ci
npm run build
npm run install:local
```

The bundle is signed as `com.royran.javis`. The installer verifies the new signature and any existing `~/Applications/Javis.app`, stops the daemon, copies the signed app, and writes `~/.local/bin/javis`. It refuses an unrelated app or launcher. Repeating the install retains the privacy-grant identity. The app bundles Node and dependency license notices; neither npm nor Orca is needed at runtime.

## Linux and Windows build and install

Run these commands from a clean Javis checkout:

```bash
npm ci
npm run build
npm run install:local
```

The build produces `dist/cli.cjs` targeting Node 22 and copies the Linux/Windows provider scripts under `dist/native/`. Use Node 22+ for installation and runtime. On Linux the installer copies it to `~/.local/share/javis` and writes `~/.local/bin/javis`. On Windows it copies it under `%LOCALAPPDATA%\Javis\app` and writes `%LOCALAPPDATA%\Javis\bin\javis.cmd`. The launcher records the absolute path of the Node executable used during installation; keep that Node installation available. Add the launcher directory to `PATH` if needed. A remote host must have a working `javis` command on the SSH session's `PATH` because the client invokes `javis rpc --stdio` there.

On Linux, install Python 3 with PyGObject and AT-SPI for the exact interpreter found as `python3` (`python3-gi`, `gir1.2-atspi-2.0`, `at-spi2-core` on common distributions). Run Javis in the user's active graphical login with its session bus. GDK/Pixbuf are needed for the provider's X11 screenshot path. `xdotool` adds X11 hotkeys, modified clicks, and synthetic Unicode typing; `wl-copy`, `xclip`, or `xsel` adds clipboard paste. Wayland may omit screenshots and X11-only input. Check `javis capabilities --json` after setup; do not assume an optional method is present.

On Windows, use Windows PowerShell 5.1 and its .NET UI Automation assemblies in the interactive user's desktop. Javis first tries a persistent PowerShell provider host and can fall back to one process per operation after host failure. An execution-policy block may trigger a single scoped fallback from `RemoteSigned` to `Bypass`; enterprise application controls can still deny script execution. Check the returned error and `javis capabilities --json` on Windows. Run Windows provider and GUI checks on Windows CI or an isolated Windows login, not on a Mac.

## Permissions, settings, and Agent installation

```bash
javis permissions status --json
javis permissions open
javis settings open
javis agent install all
```

The macOS signed app owns Accessibility for UI trees/actions and Screen Recording for PNG capture. Only the user can grant permissions. `javis permissions open [--id accessibility|screenshots]` opens setup deliberately. `javis permissions reset` resets both grants for the verified `com.royran.javis` identity, then refreshes status; it is a deliberate operation, not part of normal observation. The loopback settings page shows both statuses, refresh/setup/reset, and Codex/Claude installation state. Its token and origin checks protect mutating requests. Permission status probes are paced and coalesced in the daemon; reset invalidates cached state, and timed-out helpers are reaped.

`javis computer permissions` is the compatible setup command. It checks current grants first; when both are granted, default setup completes without opening UI. An explicit `--id` opens the selected permission's setup. Results include grant states, a next step, and whether a helper was launched. Pending repeated requests use the latest selection; reset, shutdown and caller loss cancel delivery. Existing setup helpers are replaced using exact same-user command matches, preserving passive status probes and authenticated controller helpers.

`javis agent install all` installs the Javis Skill and a user-level stdio MCP registration for Codex and Claude Code. It can be scoped to one agent. It updates managed Skill copies, refuses user edits or unsafe links, and does not replace an unrelated MCP registration named `javis`.

On Linux and Windows, macOS TCC commands and the macOS settings permission controls do not supply desktop authorization. Permission setup returns unsupported macOS grant states without opening a helper; reset is unavailable. Use the active graphical login and OS-specific permissions, then check capabilities and a read-only observation.

## Remote host and phone gateway

Use a configured OpenSSH alias and install Javis on the destination host:

```bash
javis capabilities --host <SSH-alias> --json
javis get-app-state --host <SSH-alias> --app <app> --worktree <context-id> --json
```

SSH verifies host identity; Javis uses `ssh -T <alias> javis rpc --stdio` and never exposes a daemon/helper endpoint on TCP. `--worktree` is a session context on the selected host, not a host selector. A remote screenshot is written to a private temporary file on the caller. If SSH times out or disconnects after an action request, delivery may be uncertain; inspect current state before any new action.

To use a phone browser, start the gateway on the desktop host being controlled:

```bash
javis mobile serve --bind <LAN-IP> --port 8787 --cert <certificate.pem> --key <private-key.pem>
```

For a private-LAN macOS smoke check, set the desktop's actual LAN IP and generate a short-lived self-signed certificate whose Subject Alternative Name matches that IP:

```bash
LAN_IP=192.168.1.23
mkdir -p "$HOME/.config/javis"
chmod 700 "$HOME/.config/javis"
umask 077
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 30 \
  -keyout "$HOME/.config/javis/mobile-key.pem" \
  -out "$HOME/.config/javis/mobile-cert.pem" \
  -subj "/CN=$LAN_IP" -addext "subjectAltName=IP:$LAN_IP"
chmod 600 "$HOME/.config/javis/mobile-key.pem"
javis mobile serve --bind "$LAN_IP" --port 8787 \
  --cert "$HOME/.config/javis/mobile-cert.pem" \
  --key "$HOME/.config/javis/mobile-key.pem"
```

Replace the example IP before running the commands. The phone browser or OS must trust or explicitly accept the self-signed certificate; an untrusted certificate can prevent pairing or secure-cookie use. The server prints an HTTPS URL and a one-time code valid for five minutes. Use a private LAN or tunnel. A non-loopback bind requires TLS; loopback HTTP is for testing or a trusted local reverse proxy. Pairing yields an HttpOnly, SameSite=Strict cookie with Secure on HTTPS; local loopback HTTP omits Secure for browser compatibility. Authenticated mutations also require origin and CSRF checks. Responses are no-store and do not log trees, screenshot bytes, or input text. The gateway is a separate network service; stop its process when finished. The phone controls the desktop host, not phone apps, and the page cannot supply an arbitrary SSH destination.

## Browser build and recovery

The browser runtime is pinned to Electron 43.8.10. Its npm package uses an explicit binary installer; the browser build installs that pinned runtime when absent and copies it into `dist/browser/electron`. Native automation binaries are packaged for the target platform. The macOS packager signs nested browser libraries/helpers and its own bundle before verifying the original Javis outer bundle; it preserves framework symlinks and the existing CUA identity.

Windows additionally builds the migrated security/registry modules and the pinned, patched node-pty strict-job export against Electron headers. Install Visual Studio C++ build tools and the Node/native build prerequisites before a Windows release build. No Windows native execution is established by a Mac build.

`javis daemon stop` shuts down the daemon-owned browser, native provider and connection-bound resources. Browser state lives under the selected Javis state directory's `browser/` root. Use `javis browser status --json` to inspect the process and `javis browser tab list --json` to select a page. A disconnected or timed-out action requires a fresh observation; do not replay it automatically.

`JAVIS_BROWSER_EXECUTABLE` selects the source external Chromium fallback only when Electron startup fails safely. It uses its own profile and retains source capability refusals. It is not a substitute for the desktop provider when extensions, profile operations or streaming are required.

## Diagnosis and cleanup

Use `javis capabilities --json` on the selected host. On macOS, use `javis permissions status --json` for TCC grants. `permission_denied` may indicate a missing macOS grant, Linux graphical session/AT-SPI problem, or unavailable Windows interactive desktop. `unsupported_capability` calls for checking installed Linux dependencies or choosing a supported action. `element_not_found`, `stale_snapshot`, and `window_stale` require a fresh observation in the same host and context. `background_unavailable` or `window_not_focused` requires a fresh observation and an explicit foreground choice if taking focus is acceptable. A timeout, transport loss, or post-action `observationError` requires inspection before any retry. Error envelopes include next-step guidance for recognized codes.

If `javis list-windows --app com.apple.finder --json` lists no windows, Finder has no ordinary on-screen window for Javis to observe. Its desktop background alone is not an accessibility window; `get-app-state` returns `window_not_found`. Open a Finder window manually before observing it. A zero-window result does not call for changing macOS privacy grants.

`javis daemon stop` closes the private local endpoint and reaps the provider child. macOS state lives in `~/Library/Application Support/Javis`; Linux uses `XDG_RUNTIME_DIR/javis` or `~/.local/state/javis`; Windows uses `%LOCALAPPDATA%\Javis` with a per-user named pipe. CLI screenshots use a private temporary directory and expire after 24 hours. If a process is killed during the brief daemon lock recovery critical section, `daemon.lock.recovery` can remain and startup fails closed. Confirm no daemon startup is running before removing that stale guard, then retry. Never remove an active daemon's endpoint or lock.

Browser SSH hosts can be registered and listed with `javis browser host add` and `javis browser host list`; use `javis browser host context` for another folder on the same host and `javis browser host remove --id ID` to retire it. The alias must already authenticate using normal OpenSSH configuration and the remote host must have Javis installed. Browser host data stays under Javis's private browser state directory. `JAVIS_SSH_EXECUTABLE` is an explicit transport executable override for controlled testing or managed OpenSSH installations; it does not bypass Javis's private daemon authentication or the source page/lease checks.
