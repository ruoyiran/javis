# Independent browser acceptance

Status: the extended browser and stdio/mobile acceptance scripts pass against production candidate `0ad7a91`, rebuilt in Javis on 2026-11-19. The complete independent-copy checks pass at QA commit `7388bcb` with 74 files / 368 tests, all three TypeScript gates, a public cold install, signed macOS distribution, seven notices and hidden browser startup. This completes the tested local scope. Complete three-platform Orca browser parity is **not certified** by this report.

## Reproduce

From the standalone Javis repository after its final browser build:

```sh
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/hidden-behavior.mjs
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/stdio-stream-behavior.mjs
```

Both scripts create fresh temporary state, local HTTP fixtures and disposable files. All Electron windows remain hidden. CDP input targets only the hidden fixture renderer/guest. The stdio script copies the full built distribution outside the checkout, preserves relative Electron framework symlinks, and executes that copy's CLI/daemon/browser. No source, build or runtime operation references the sibling Orca checkout. Neither script installs applications, changes Agent user configuration, imports personal browser data, accesses existing desktop windows, or emits screenshot bytes/accessibility trees. Logs contain only named outcomes and controlled failure summaries. Temporary state and owned processes are removed on completion.

## Actual passing behavior

The final hidden browser script exited **0** after exercising the actual engine, preload and renderer:

- Public tab creation, real field input/click effects and exact `expectUrl` rejection before mutation.
- Real default-profile Cookie plus local/session storage writes, observed in the executing page and preserved through reload.
- Isolated profile switching: Cookie/local storage absent in the isolated profile and restored when switching back to default.
- Actual local upload and **cross-frame upload using the snapshot's real frame ref**, with the expected file name, byte size and exact uploaded contents read from the browser's File object.
- Confirm dialog: the input reports `browser_dialog_opened`, the caller answers the existing dialog without repeating input, and suspended page JavaScript resumes with the accepted result.
- A real HTTP download produces the exact controlled bytes in the temporary destination.
- Viewport mutation changes the actual page's `innerWidth/innerHeight` to 720×480.
- Screenshot/annotated screenshot returns a real PNG at the configured 720×480, full screenshot returns a real PNG, and PDF capture returns a real `%PDF-` document. Bytes are checked in memory and never logged.
- Restart preserves stable saved page IDs. Status/list/closing an unmounted page do not contact that page's fixture endpoint; later page execution lazily restores the persistent Cookie/local-storage data.
- Annotation delivery identity and acknowledged receipt survive process restart; acknowledged deliveries are omitted from the pending list, retained in the receipt list and isolated from another context.
- A controlled unpacked MV3 extension injects its real content script into an executing guest. Editing/reloading the extension changes the next navigation's injected value; disabling prevents injection on the next navigation, and removal succeeds. All extension state/files are temporary.
- Both the restored ordinary-folder context and a fresh opaque context mount browser chrome. Explicit public creation controls a real hidden renderer guest. Rendered guest profile switching actually remounts with isolated Cookie/local storage and then restores the default profile data. Floating workspace opens its own registered guest and hides on minimize.
- A rendered prompt is answered (`accepted:true`), after which another field input succeeds with the exact requested value. This checks answer delivery and unblocking; it does not claim deterministic supplied prompt-text behavior under the pinned legacy CDP race described below.
- The actual workspace preload forwards file stat/read through the real Javis host dispatcher. Opening a local HTML fixture's Source control mounts Monaco; CDP typing and Meta+S replace the file with the exact controlled bytes through its granted ordinary folder. No native focus or OS file dialog is used.

The independently copied distribution's stdio acceptance **exited 0** and passed all its behavior groups:

- One-shot stdio-as-SSH routing executes real browser fill/click/eval and reports `visible:false`.
- Two authenticated device connections deliver real source JPEG frames at 400×800. A different device's acknowledgment returns `credited:false`; each owner's acknowledgment returns `credited:true`. After credit and a page update, a later real frame arrives with advancing sequence.
- Mobile input affects only its server-bound selected page. Caller page override is rejected. Closing one device invalidates its input freshness while the other device continues acting successfully.
- The real stdio host file channel reads controlled bytes from a granted ordinary folder and rejects a parent-path escape.
- The served gateway's real mobile page pairs at 390×844 in headless Chromium, receives actual source JPEG through SSE and decodes it under the shipped CSP. Selecting page B clears page A's image/source; starting page B's stream displays a newly decoded image. Browser data flows to the copied daemon/browser through the actual stdio transport. The unrelated desktop-app discovery response is a controlled empty fixture.

This is real subprocess/frame/page evidence. The SSH executable is a local fixture wrapper around the copied CLI; it does **not** prove OpenSSH authentication, host-key checking, separate-machine routing, or a physical phone's TLS/network behavior. The gateway rendering check uses loopback HTTP and headless Chromium.

## Concrete findings and corrections

1. The independent `expectUrl` fixture initially delivered input on a mismatched URL. Engine owner confirmed the standalone service omitted upstream `runWithRequestedPageUrl` around copied RPC handlers. The wrapper was added, rebuilt and the actual fixture now passes.
2. The source editor requests `browser.host.call(files.stat)`, but the service's allowlist initially rejected it. This was reproduced through the real workspace preload. Engine owner added the exact stat method; the rebuilt real preload stat and source-editor save now pass.
3. The renderer initially created a page ID that had no registered guest. Renderer owner replaced direct BrowserPane wrappers with the original overlay/slot implementation. Renderer owner also corrected the host hydration fallback for saved groups whose active tab was null. The final candidate now passes restored-folder initial chrome, fresh-context chrome, explicit guest creation, profile remount and floating guests.
4. Source editor clients initially treated `BrowserHostBridge.call`'s `{ok,result,_meta}` response as raw file fields. This was identified by contract inspection and then confirmed through the real preload (nested fixture size 15). The trusted file endpoint now unwraps success and rejects failure. Live stat/read/Open Source/edit/save verification passes.
5. The pinned source's legacy CdpManager auto-answers `Page.javascriptDialogOpening` without prompt text. Engine owner verified this listener is unchanged from the pinned Orca file. After legacy CDP attachment it can race the managed prompt callback and return the prompt's default empty answer. The race produced different text answers across runs. Its timing-dependent text assertion was removed under the repository test policy; the fixture instead verifies accepted dialog delivery and subsequent page input. Supplied-text prompt behavior is not claimed. A separate upstream bugfix was not performed.

Fixture expectation corrections were kept distinct from product defects: eval scalars are strings; persistent restart Cookies need an expiry; cross-frame upload uses the actual snapshot ref; opening a dialog truthfully raises a delivered-action error; foreign ACK refusal is `credited:false`, not an exception. The first copied-dist launch failed because default Node `cp` rewrote Electron symlinks; `verbatimSymlinks:true` fixed the independent copy. Monaco's input textarea is not a clickable editor surface; the fixture now clicks the visible editor before keyboard input. Source page IDs and outer workspace tab IDs are distinct, so the file fixture selects its public tab label. These were fixture corrections, not product defects.

## Remaining evidence

No conclusion of full parity should be drawn from the command/method inventories or unit suites. Outstanding full-spec evidence includes source-versus-Javis rendered comparison under fixed viewport/theme/language, deeper rendered crash/restart recovery, complete split/tab/DevTools/history/menu/annotation interaction, popup/crash/stale-ref recovery, Web Store/permission/update/native-messaging flows, password vault/platform reauthentication/WebAuthn, certificate/site-permission/network-control details, granted remote placement/lease loss/network host switching/file transfer, physical phone reconnect and backpressure, and isolated native-focus checks. macOS local runs do not verify Linux/Windows GUI behavior; those require isolated platform CI/display sessions. Signing/build/TS/whole-suite evidence is controller-owned and is not inferred here.

Scope of changes: only `tests/browser/acceptance/` and this report. Syntax checks and scoped `git diff --check` pass. No other worker's source or report was edited.


## Final-wave independent QA

QA commits `bfdd933` and `86b8da7` add the reproducible surface comparison, its six controlled artifacts, a clean-copy verification runner, and portable core screenshot output. Production code was not edited by this QA worker.

Visual command:

```sh
ORCA_BACKGROUND_LAUNCH=1 JAVIS_TEST_ARTIFACT_DIRECTORY=/tmp/javis-browser-visual-qa node tests/browser/acceptance/surface-comparison.mjs /path/to/read-only-orca
```

Both sides are production-built in temporary directories. The reference uses `git archive 729f757b592244176420a86114c1ea23911eeeba`, actual components/primitives/CSS/fonts/catalog, and explicit temporary Tailwind source discovery. Shared fixture boundaries provide empty host/store/IPC data; component UI is not replaced. At 1440×900, dark, en-US, DPR1, all source/Javis scenes rendered without page errors. Actual BrowserChromeToolbar with supplied address/menu slots, empty BrowserNewTabPage, and actual homepage/search/default-zoom rows within SettingsGroup have zero differing pixels and zero mean channel difference. These exact limited scenes are stored in `tests/browser/acceptance/artifacts/` with `results.json` and README. No full desktop-shell/settings/guest visual certificate is implied.

Portable core check command:

```sh
ORCA_BACKGROUND_LAUNCH=1 JAVIS_TEST_ARTIFACT_DIRECTORY=/tmp/javis-core-qa-artifacts node tests/browser/runtime/hidden-browser-acceptance.mjs
```

This check exits 0 and creates its PNG in the supplied directory. Without an artifact environment variable it uses its own temporary directory, cleaned on exit; CI must set the variable before artifact upload. Reference Orca status remains clean.

Clean-copy command (run after the final production-fix commit notification):

```sh
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/clean-copy.mjs
```

It excludes `.git`, `node_modules`, `dist`, `build`, `.superpowers`, and native `.build`; runs npm ci/typecheck/test/full build; verifies seven nonempty packaged license notices; then runs hidden browser acceptance in the independently installed/copied project. Final execution completed successfully after the production-fix commit; see the final result below. No app installation, Agent registration, push, or native desktop mutation is performed.


### Final clean-copy result

The final run exited **0** from `7388bcb` (QA copy-filter correction on settled production candidate `0ad7a91`). Only the controller's verification documentation remained dirty; QA changed no production source. The repository was copied into a fresh directory outside the checkout, without `.git`, any `node_modules`, top-level `dist`/`build`, `.superpowers` or native `.build`. Legitimate `tests/build` source was retained. A fresh npm cache under the disposable directory forced actual public-registry installation.

Exact command:

```sh
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/clean-copy.mjs
```

All stages exited 0:

| Stage | Result |
| --- | --- |
| Public lock tarball URLs and production source dependency audit | No internal registry URLs, @orca imports/requires, or absolute sibling runtime references |
| `npm ci` | Passed with isolated public npm cache |
| `npm run typecheck` | Core + browser node + browser web gates passed |
| `npm test` | 74 files, 368 tests passed |
| `npm run build` | Full macOS build passed; browser app and outer Javis.app strict signature verification reported valid on disk and satisfied designated requirements |
| Packaged notice inspection | All seven expected notices present and nonempty |
| `node tests/browser/runtime/hidden-browser-acceptance.mjs` | Real renderer/guest/snapshot/guarded input/hidden-window checks passed; no page errors |

Logs and machine-readable results: `.superpowers/sdd/2026-11-19-orca-browser-parity/clean-copy-qa/`. Temporary copied source, dependencies, npm cache, application bundle and runtime state were removed on completion. No application installation, Agent configuration change, push, visible app or native desktop mutation occurred. The reference Orca working tree remains unchanged.

Two QA harness corrections were kept separate from product defects: sharing `JAVIS_STATE_DIR` across parallel unit tests bypassed a mocked homedir, so that override is removed only during unit execution; excluding every directory named `build` omitted two legitimate build tests, so only top-level build artifacts are excluded. Earlier runs are superseded, and the final complete 368-test run is the accepted result.

This is macOS source/build/packaging/core-browser evidence plus the exact presentational visual scope above. The controller owns extended current-checkout browser, remote client-host, global-owner and HTML fixture results. Linux/Windows workflows are definitions for future isolated execution; this report does not turn macOS results into Linux/Windows GUI verification.
