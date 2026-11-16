# Build and operations

## macOS build, sign, and install

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

`javis agent install all` installs the Javis Skill and a user-level stdio MCP registration for Codex and Claude Code. It can be scoped to one agent. It updates managed Skill copies, refuses user edits or unsafe links, and does not replace an unrelated MCP registration named `javis`.

On Linux and Windows, macOS TCC commands and the macOS settings permission controls do not supply desktop authorization. Use the active graphical login and OS-specific permissions, then check capabilities and a read-only observation.

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

## Diagnosis and cleanup

Use `javis capabilities --json` on the selected host. On macOS, use `javis permissions status --json` for TCC grants. `permission_denied` may indicate a missing macOS grant, Linux graphical session/AT-SPI problem, or unavailable Windows interactive desktop. `unsupported_capability` calls for checking installed Linux dependencies or choosing a supported action. `element_not_found`, `stale_snapshot`, and `window_stale` require a fresh observation in the same host and context. `background_unavailable` or `window_not_focused` requires a fresh observation and an explicit foreground choice if taking focus is acceptable. A timeout, transport loss, or post-action `observationError` requires inspection before any retry. Error envelopes include next-step guidance for recognized codes.

If `javis list-windows --app com.apple.finder --json` lists no windows, Finder has no ordinary on-screen window for Javis to observe. Its desktop background alone is not an accessibility window; `get-app-state` returns `window_not_found`. Open a Finder window manually before observing it. A zero-window result does not call for changing macOS privacy grants.

`javis daemon stop` closes the private local endpoint and reaps the provider child. macOS state lives in `~/Library/Application Support/Javis`; Linux uses `XDG_RUNTIME_DIR/javis` or `~/.local/state/javis`; Windows uses `%LOCALAPPDATA%\Javis` with a per-user named pipe. CLI screenshots use a private temporary directory and expire after 24 hours. If a process is killed during the brief daemon lock recovery critical section, `daemon.lock.recovery` can remain and startup fails closed. Confirm no daemon startup is running before removing that stale guard, then retry. Never remove an active daemon's endpoint or lock.
