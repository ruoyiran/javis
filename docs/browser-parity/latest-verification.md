# Latest browser and desktop CUA verification

Fixed source: Orca `d3a843d032f602cf09e392613683a94089efce07`; migration ancestor `729f757b592244176420a86114c1ea23911eeeba`; Javis base `b5c1080`. Work is retained on `feat/orca-browser-cua-latest-parity` in the requested Javis checkout. Production code candidate: `d3509aa`; later documentation commits do not change that code.

The [fixed inventory](orca-d3a843d-baseline.json) records all 83 browser commands, 16 desktop CUA commands, and 101 browser methods. The [command parity record](latest-command-parity.md) explains parameters and platform behavior. Browser Electron 43.8.10 and agent-browser 0.43.0 ship together; the native desktop providers remain independent. No Orca checkout is needed to install dependencies, build, or run Javis.

## Actual verification

The following checks ran on macOS on 2026-11-20. Browser launches used `ORCA_BACKGROUND_LAUNCH=1`, temporary state, hidden renderers and loopback CDP. No user desktop input or native permission UI was used.

| Check | Result | Scope |
| --- | --- | --- |
| Final TypeScript gates | Core, browser node/preload, and renderer passed | Candidate `d3509aa` |
| Final JavaScript suite | 88 files / 433 tests passed | CLI/MCP, runtime/provider contracts, browser, SSH framing, settings/mobile and lifecycle |
| Native macOS tests | 24 Swift tests passed | Helper unit/protocol and real image encoding |
| Linux provider fixtures | 18 Python tests passed | Fake GI objects on macOS; not Linux GUI evidence |
| Fixed inventory audit | 83 browser commands / 101 methods; 89 public / 12 internal; none missing | Interface inventory, separate from behavioral checks |
| Independent command review | 83 handlers/specs, no missing required flags after Javis selector adaptation; 16 CUA paths reviewed | Parser/schema coverage |
| Full macOS distribution | `npm run build` passed; nested browser and outer app strict signatures passed | Final candidate; existing Javis controller identity retained |
| Packaged CLI | Bundled Node/CLI returned version 0.2.0 from `/tmp` | Packaged entry/resource lookup |
| Extended browser | 20/20 hidden engine/renderer cases passed | Profile/storage restore, upload/download, cross-frame input, image/PDF, extensions, annotations, floating pages and source editing; earlier browser integration build |
| Latest browser behavior | 5/5 passed on final trace-free browser integration distribution | Zoom/reset, pending navigation stop, stdin validation, extension side panel/API isolation and repeated exact source saves |
| Final remote client host | All 19 named outcomes passed | Actual separate daemon/browser processes, lease/census, 819220-byte fixed-hash result, server headless placement, pending/ready initialization, stale pairing/context refusal, warm/cold recovery and no input replay |
| Final framed/mobile fixtures | 5/5 passed | Copied distribution, device/frame/ACK isolation, granted file channel and actual JPEG in paired phone viewport |
| Local HTML artifact | Passed, zero renderer errors | Loaded artifact reads granted; unopened files refused; hidden real guest |
| Owner lifecycle | Passed | Controlled protocol peer shutdown/fallback/ownership, no replay or surviving owned peer |
| Cold independent source copy | Passed; all stages exit 0, including 433 tests and hidden startup with zero renderer errors | Fresh public npm cache, no sibling/build/dependency artifacts, all TS/tests/build/notices/hidden startup |
| Dependency/source audit | All HTTPS tarballs public; 9 updated package integrities matched official registry; no production `@orca/*` imports or sibling paths | Source/build/native scan; Orca tree remained clean at fixed reference |

Native, renderer, browser integration and core adapters received independent scoped reviews. The native reviews led to provider-derived subtree/PID/window validation and valid Windows non-main window handling. Renderer review led to initialization transport and stranded-draft checkpoint fixes. Core review led to end-to-end passive read deadlines and unpublished wait observations. Final whole-branch review: pending candidate review after these completed verification gates.

## Wait delivery and authority

Passive allowances up to 120000 ms reach authenticated local/SSH transport queues and provider execution. Input, launch, permissions and `restoreWindow:true` retain their original delivery bounds. Wait remains adapter polling of existing reads; it is not a new provider or SSH wait method and does not hold the daemon queue between polls.

Non-observing capabilities negotiate daemon-owned `observationStaging:true` before text/enabled polls. Transport-only staging clears addressed authority and keeps a bounded provisional observation. Exact, unexpired, same-target publication returns that observation without a provider reread. Failed/cancelled unpublished polls cannot authorize indexed input even when cleanup is unreachable. Owning deterministic tests reproduced the previous 60-second queue loss and `wait_timeout` followed by accepted indexed input; both now reject or complete correctly.

Successful publication retains the ordinary one-shot read contract. If remote publication finishes and its local reply is received, then the outer SSH reply is lost, the daemon cannot prove final caller receipt. Refresh inspection after uncertain publication; never replay automatically. No new general action observation-token or acknowledgement protocol was added.

## Reproduce

Use a development Node executable. On this host it is selected with `PATH=/opt/homebrew/bin:$PATH`.

```sh
ORCA_BACKGROUND_LAUNCH=1 npm run typecheck
ORCA_BACKGROUND_LAUNCH=1 npm test
node scripts/audit-browser-contract.mjs
swift test --package-path native/javis-macos
python3 -m unittest discover -s native/javis-linux -p '*test.py'
ORCA_BACKGROUND_LAUNCH=1 npm run build
codesign --verify --deep --strict build/Javis.app
codesign --verify --deep --strict 'build/Javis.app/Contents/Resources/browser/Javis Browser.app'
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/latest-behavior.mjs
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/remote-client-host.mjs
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/stdio-stream-behavior.mjs
ORCA_BACKGROUND_LAUNCH=1 JAVIS_TEST_ARTIFACT_DIRECTORY=/tmp/javis-cold-qa node tests/browser/acceptance/clean-copy.mjs
git diff b5c1080..HEAD --check
```

The acceptance scripts own temporary state/processes. `JAVIS_BROWSER_ACCEPTANCE_DIST` can select an already completed private distribution. The cold-copy script excludes `.git`, dependencies, build output and native build artifacts; it uses a separate public npm cache and cleans its source copy after saving results.

## Evidence limits

The remote fixture uses a local SSH-like stdio wrapper, not a real OpenSSH connection or another machine. The phone uses a reproducible headless Chrome viewport, not a physical phone/LAN/TLS session. Linux AT-SPI/Wayland and Windows GUI/native execution were not run on this macOS host. Windows protocol validation is `native/javis-windows/runtime-protocol.test.ps1` and needs Windows. Native mutable input/focus/launch/permission flows require isolated graphical sessions on each OS.

Inventory coverage does not certify that every password, WebAuthn, extension permission/native-messaging, site permission/certificate, menu/DevTools or platform path was physically exercised. The migrated implementation and recorded behavior checks are separate evidence. Installation, Agent user configuration changes, push and merge were outside these source/build steps.

## Controller decisions

1. When explicit subagent model routes repeatedly disconnected, implementation temporarily proceeded directly. Available inherited-runtime workers later completed the assigned scopes and independent reviews. Cost if mistaken: the early implementation lacked simultaneous independent review; the completed scopes were subsequently reviewed.
2. Successful wait publication keeps the existing ordinary-read delivery contract instead of introducing an action observation-token/acknowledgement protocol. Cost if mistaken: an outer SSH reply lost after completed remote publication can leave server authority despite absent caller receipt; uncertain results require fresh inspection and no automatic replay.
