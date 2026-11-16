# Javis mobile browser CUA design

## Scope

The user explicitly chose a new phone-browser computer-use interface. Orca Mobile has no `computer.*` route, so this is a Javis feature beyond literal Orca Mobile parity. The browser is a remote control for a Javis installation on a desktop host; it never automates the phone's own apps or an iOS/Android emulator.

## Connection and trust

`javis mobile serve --bind <LAN address> --port <port> --cert <PEM> --key <PEM>` starts a separate HTTPS gateway. A non-loopback bind requires TLS certificate and key; plain HTTP is allowed only on `127.0.0.1` for testing or a trusted local reverse proxy. The gateway prints its URL and a random, one-time pairing code valid for five minutes. The user opens the URL on a phone and enters the code. A successful pair consumes the code and issues a random HttpOnly, SameSite=Strict session cookie; HTTPS adds Secure, while loopback HTTP omits it so browsers can use the local test page. Pairing attempts are rate-limited; all app/screenshot/action endpoints require that cookie. Mutating endpoints also require a same-origin `Origin` and CSRF header. Responses carry `Cache-Control: no-store`, restrictive CSP and `Referrer-Policy: no-referrer`. The gateway never logs trees, screenshots, or typed text.

The gateway serves fixed HTML/JavaScript and forwards calls to the local Javis daemon through the public `callJavis` API. It never publishes the daemon or helper socket. To operate a remote desktop, run the gateway on that desktop (or use an explicitly configured Javis SSH host; the UI must not accept arbitrary SSH destinations from the phone).

## Mobile interaction

The page lists apps and their windows, shows the current screenshot and accessibility tree, and provides controls for all nine Javis actions. Tapping a screenshot maps CSS pixels to screenshot pixels, then divides by `screenshot.scale` to obtain window-local point coordinates. The selected app/window and Javis session ID are stored on the gateway per paired device, not trusted from browser action payloads. `getAppState` refreshes that session; actions require a recent observation and use the same target. Background input remains default where the provider supports it; a visible toggle requests `restoreWindow`.

After every action the page displays the returned observation. If an action was delivered but observation failed, it shows the delivery warning and disables further actions until a fresh observation. A network timeout/disconnect is treated as uncertain delivery; the page never automatically resends an action. Screenshot bytes remain in memory and are embedded as a data URL only in the authenticated page. No screenshot file path from a remote host is offered as a local file.

## Verification

Unit/integration tests use a loopback HTTP gateway with fake Javis calls. They assert one-time pairing, unauthenticated denial, CSRF denial, per-device session isolation, coordinate scaling, action method allowlisting, and no action retry after an ambiguous failure. A manual phone smoke check requires a private LAN or tunnel and a trusted/accepted HTTPS certificate. Mutable UI checks run only against an isolated desktop test fixture, never the user's active session.
