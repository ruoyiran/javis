---
name: javis
description: Use when an agent needs to inspect or operate a visible macOS app window through Javis and a direct API, terminal command, or file operation cannot complete the task.
---

# Javis Computer Use

Use Javis for macOS app windows. Prefer the `javis_*` MCP tools when available; the `javis` CLI exposes the same desktop actions. Keep the user's current app and pointer undisturbed unless foreground control is necessary.

## Start with a fresh view

```bash
javis capabilities --json
javis list-apps --json
javis get-app-state --app com.apple.finder --json
```

Read controls from `result.snapshot.treeText`. CLI observations return `result.sessionId`; pass it to every following action with `--session`. MCP tools keep a session per connection. Indexes may be sparse and expire after UI changes or two minutes. Refresh state before choosing a new index.

```bash
javis click --app com.apple.finder --session <sessionId> --element-index 42 --json
```

Actions return another snapshot. If `snapshot.treeDiff` is present, read `~` as changed and `-` as removed; unchanged controls keep their indexes. Use `--full-tree` if the complete tree is needed. Screenshot coordinates are relative to the window; divide screenshot pixels by `screenshot.scale` before sending coordinates. CLI JSON saves screenshots at `result.screenshot.path`; MCP returns an image block.

## Choose the action

- Prefer `set-value`, an element click, or a listed secondary action. Use coordinates only with a current screenshot when accessibility targeting fails.
- For a popup or web `<select>`, use `set-value` on its element. A background click on these controls is refused because it can open an off-screen menu or wedge input.
- Background input is the default. `--restore-window` takes focus and can move the real pointer; tell the user before using it while they work in another app.
- `action.verification.state=unverified` means the effect is unknown. Inspect the returned snapshot or the destination before reporting success or retrying. Never blindly repeat a click, key, submit, or purchase after a timeout.
- If `result.observationError` is present, the action was delivered but the follow-up observation failed. There is no fresh snapshot. Inspect the app or destination again; do not repeat the action.
- If `element_not_found` or `window_stale` occurs, observe again. If `app_blocked` occurs, stop using Javis on that app.

Use `--text-stdin` and `--value-stdin` for sensitive text so it is absent from shell history. Read or change only what the user requested. Sending messages, submitting forms, purchases, deletions, and account changes require the user's authorization for that action.

If `permission_denied` or `screenshot_failed` names macOS permissions, run `javis permissions status --json`; have the user complete `javis permissions open` when a grant is missing. Normal observations do not open System Settings.
