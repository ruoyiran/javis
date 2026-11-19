# Browser surface comparison

Reference: Orca `729f757b592244176420a86114c1ea23911eeeba`, extracted with `git archive` into a temporary directory. No build writes occur in the reference checkout.

Both sides use their actual component implementations, shadcn primitives, canonical main CSS, fonts and English catalog. The common fixture supplies controlled host/store/IPC boundaries. Conditions: 1440×900, dark, en-US, DPR 1, reduced motion, headless Chromium on macOS.

The six PNGs and `results.json` record zero differing pixels and zero mean channel difference for:

- `BrowserChromeToolbar`, with a supplied fixture address slot and menu trigger.
- `BrowserNewTabPage`, with no workspace, history, ports or import hint.
- The actual homepage/search/default-zoom setting rows inside `SettingsGroup`.

This is presentational evidence for those exact surfaces. It does not certify the desktop shell, webviews, address suggestions, complete settings, other themes/viewports, native focus or Linux/Windows GUI behavior. The supplied address/menu content is explicitly part of the fixture, while navigation and annotation controls use the source toolbar implementation.

Reproduce from Javis with its installed development dependencies and a read-only Orca checkout:

```sh
ORCA_BACKGROUND_LAUNCH=1 \
JAVIS_TEST_ARTIFACT_DIRECTORY=/tmp/javis-browser-visual-qa \
node tests/browser/acceptance/surface-comparison.mjs /path/to/orca
```

Set `JAVIS_TEST_CHROMIUM` to a headless-compatible Chromium executable on other hosts. The default is the macOS Chrome path. Reference paths are QA arguments; production source/build/runtime does not depend on the checkout. Generated diff images and metrics remain in the selected artifact directory. Pixel comparison is artifact QA, not a copied CSS/translation unit test.

For independent build verification after the final candidate commit:

```sh
ORCA_BACKGROUND_LAUNCH=1 node tests/browser/acceptance/clean-copy.mjs
```

That script copies outside the checkout without `.git`, dependencies, build artifacts or native `.build`, then runs `npm ci`, typecheck, tests, the full build and a hidden browser check. It never installs the application or Agent configuration. Its logs/results are written to `JAVIS_TEST_ARTIFACT_DIRECTORY` or the ignored scratch QA directory.
