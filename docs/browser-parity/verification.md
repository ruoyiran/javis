# Browser migration verification

The implementation is pinned to Orca `729f757b592244176420a86114c1ea23911eeeba` and starts from Javis `4de676041a74217228dc1c3c4aeda89aa394ca47`. The fixed [source inventory](orca-729f757-baseline.json) records 83 browser CLI commands and 97 browser RPC methods. Inventory coverage establishes the interface scope; it does not certify every browser behavior.

The implementation lives in Javis on `feat/orca-browser-parity`. The approved design allows Electron only for the separate browser subsystem. Javis owns the source, renderer, transport, daemon, data directory and distribution. Existing native desktop CUA providers remain independent.

## Verification record

Final production candidate: `0ad7a91`; clean-copy QA commit: `7388bcb`. The following checks completed on 2026-11-19. The original process/catalog findings and the remaining publication defect were corrected; no known implementation defect remains in the reviewed scope. Detailed [acceptance evidence and limits](acceptance.md) are retained separately.

| Check | Actual evidence | Scope |
| --- | --- | --- |
| TypeScript | Core, browser main/preload and renderer projects pass | Local TypeScript checks |
| Fixed contract audit | 83 CLI mappings, 97 RPC schemas; 87 public / 10 internal; no missing entries | Inventory coverage, separate from behavioral checks |
| JavaScript tests | 74 files / 368 tests pass in the requested checkout and complete independent copy | CLI, MCP, private transport, lifecycle, browser behavior, remote/mobile and existing CUA regressions |
| macOS native tests | 23 Swift tests pass | Native helper unit/protocol behavior |
| Linux provider tests | 18 Python tests pass | Fake GI/AT-SPI fixtures, executed on macOS |
| Signed distribution | Full macOS build and strict nested/outer signature verification pass | Existing Javis identity plus separate `com.royran.javis.browser` |
| Packaged CLI | Bundled Node/CLI starts the browser from `/tmp` with temporary state | Packaged executable and resource lookup |
| Hidden browser | Real Electron workspace and guest, snapshot, URL-guarded fill/click/eval; `visible:false`, zero renderer errors | Temporary hidden fixture over loopback CDP |
| Extended browser | Profile isolation/remount, Cookie/storage persistence, upload including a real cross-frame ref, download bytes, screenshots/PDF, MV3 extension reload/disable/remove, stable lazy restore, annotation receipts, floating guests, actual Monaco source editing/save | Actual engine/preload/renderer on macOS |
| Copied distribution and frame transport | Copied CLI/daemon/browser; one-shot stdio and framed two-device JPEG/ACK/input isolation; granted host file read and path-escape rejection; paired gateway page decodes JPEG, clears the old page and reconnects | A local stdio wrapper stands in for SSH; loopback headless phone page |
| Client-host lifecycle | Two real daemons/browser engines: source lease and guest, remote snapshot, local A retained, remote B/C coexist, volatile DOM survives brief link loss, both-engine restart recovery, server placement and removed-owner denial; recovered renderer metadata accepted without replay | Controlled SSH executable, actual source composition and retained renderer |
| Local HTML artifact | Actual hidden renderer/guest reads its loaded HTML and rejects an unopened file; zero renderer errors | Authorized local filesystem bridge |
| Cold independent copy | Public npm install with isolated cache, all three TS gates, complete unit suite, full signed macOS build, seven nonempty notices and hidden browser startup pass | Final production candidate; no sibling source, dependencies or build artifacts copied |
| Rendered comparison | Toolbar, new-tab page and homepage/search/zoom settings rows: zero differing pixels and zero mean channel difference | Actual source components, 1440×900, dark/en-US/DPR1; [controlled artifacts](../../tests/browser/acceptance/artifacts/README.md) |
| Windows native patch | Pinned node-pty patch applies and repeat application is detected | Source patch verification on macOS |
| Source independence | No `@orca/*` imports or sibling checkout paths in production/build source; Orca working tree unchanged | Read-only source extraction and scan |
| Public dependencies | Restored 651 internal mirror tarball URLs to public npm without version/integrity changes; key engine pins match official registry integrity | Final cold install fetched through the public registry with an isolated cache |
| Agent skill reference | Fresh agents retrieve guarded CSS/ref fill, observe after uncertain input, choose SSH/folder screenshot flags, and avoid claiming external CUA discovery | Reference retrieval; actual commands covered by separate browser fixtures |

## Reproduce

Use a development Node executable and fresh test state. The scripts create their own fixture state and clean up owned processes. They do not install Javis or change Agent user configuration.

```sh
npm ci
npm run typecheck
node scripts/audit-browser-contract.mjs
ORCA_BACKGROUND_LAUNCH=1 npm test
swift test --package-path native/javis-macos
python3 -m unittest discover -s native/javis-linux -p '*test.py'
npm run build
codesign --verify --deep --strict build/Javis.app
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/runtime/hidden-browser-acceptance.mjs
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/hidden-behavior.mjs
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/stdio-stream-behavior.mjs
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/runtime/global-owner-lifecycle.mjs
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/remote-client-host.mjs
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/local-html-artifact.mjs
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/clean-copy.mjs
git diff 4de6760..HEAD --check
```

Swift and codesign checks require macOS and an available signing identity. The stdio gateway fixture currently selects Chrome on macOS unless `JAVIS_TEST_CHROMIUM` supplies another Chromium executable. The [platform workflow](../../.github/workflows/browser-validation.yml) defines Linux Xvfb and Windows build/hidden-browser checks. Adding the jobs is not evidence that they have run.

## Evidence limits

The migration is not a certificate of complete three-platform behavioral parity. Local macOS runs do not prove Linux/Windows GUI, native focus or permission behavior. Native mutable checks require an isolated graphical session. The fixed visual comparison covers its three presentational scenes; it does not certify complete webview/desktop/settings interaction or every theme and viewport.

The local stdio wrapper does not prove OpenSSH authentication, host-key checking or separate-machine networking. The headless loopback mobile page does not prove a physical phone's TLS or network behavior. Advanced flows still need targeted platform acceptance: Web Store installation and permission/update/native-messaging flows, password vault reauthentication and WebAuthn, certificate/site permission flows, and complete crash/menu/DevTools interactions.

The pinned source's legacy CDP listener may auto-answer an already opened prompt before the managed supplied-text answer. This inherited race is preserved; the acceptance checks accepted dialog delivery and subsequent input rather than asserting a timing-dependent prompt value.

The final scoped review addressed the process race, original catalog/preload omissions and whitespace violations. Its residual page-publication filter was a real recovery defect. The bounded correction establishes ownership on the verified source-ready lease before initial recovery events, rejects foreign/stale/failed claims and clears ended claims. Three owning regression cases failed on the old forwarding implementation and pass after the correction; the actual recovered renderer's metadata is accepted under its current placement. The final legacy hidden-browser and copied stdio/mobile scripts also exit 0 after rebuilding.

## Implementation decisions

These are all controller rulings recorded during this migration, including their cost if mistaken.

1. Work in the exact Javis checkout requested by the user on a new feature branch. A second checkout would change the requested destination; a mistaken interpretation would require relocating the work.
2. Copy non-executable skill helper scripts into migration scratch storage and make only those copies executable. This changes no product behavior and avoids modifying the installed skills; a mistaken helper interpretation would require repeating the workflow bookkeeping.
3. Replace agents that repeatedly disconnected before writing code with available workers while retaining the same scope and review boundaries. The cost is additional execution/review effort rather than reduced functionality.
4. Apply a single type-only indexed lookup cast requested by the renderer owner while the concurrency cap prevented the source owner from taking a turn. The runtime lookup is unchanged and was included in the engine/final review; a mistaken type assumption could conceal an invalid key and require a narrower type fix.
5. Correct the final review's remaining page-publication defect before delivery. It is required for client-host recovery, so the bounded correction continues within the approved task after the generic final review limit. A mistaken ownership claim could expose another host's metadata or retain failed claims; initial/later owner delivery and foreign/failed/ended-claim isolation must be checked.

Application installation, importing personal browser data, changing Codex/Claude user configuration, pushing, and merging were not performed.
