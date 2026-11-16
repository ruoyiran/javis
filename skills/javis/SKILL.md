---
name: javis
description: Use when an agent needs to inspect or operate a desktop app window on macOS, Linux, or Windows through Javis and a direct API, terminal command, or file operation cannot complete the task.
---

# Javis Computer Use

Use Javis for desktop app windows on a local or explicitly selected SSH host. Prefer the `javis_*` MCP tools when available; the `javis` CLI exposes the same desktop actions. Check `javis capabilities --json` on the target host because provider support differs. Keep the user's current app and pointer undisturbed where background input is supported.

## Start with a fresh view

```bash
javis capabilities --json
javis list-apps --json
javis get-app-state --app com.apple.finder --json
```

Read controls from `result.snapshot.treeText`. CLI observations return `result.sessionId`; pass it to a following action with `--session`, or use the same `--worktree <opaque-id>` for both calls. Without either flag, the CLI derives a session context from the canonical current directory, including ordinary folders. `--worktree` and `--session` are mutually exclusive. MCP tools keep a session per host and context within the connection. An index belongs to the selected host, context, app, and window; it may be sparse and expires after UI changes or two minutes. Refresh state before choosing a new index.

```bash
javis click --app com.apple.finder --session <sessionId> --element-index 42 --json
```

Use `--host <SSH-alias>` on each CLI call, or the MCP `host` field, to target a Javis installation on another desktop. An SSH host is explicit; a worktree or folder context never changes the host. The remote machine needs an active graphical login and its own platform provider. Remote screenshots are copied into the caller's private temporary file, never reported as remote file paths.

Actions return another snapshot. If `snapshot.treeDiff` is present, read `~` as changed and `-` as removed; unchanged controls keep their indexes. Use `--full-tree` if the complete tree is needed. Screenshot coordinates are relative to the window; divide screenshot pixels by `screenshot.scale` before sending coordinates. CLI JSON saves screenshots at `result.screenshot.path`; MCP returns an image block.

## Choose the action

- Prefer `set-value`, an element click, or a listed secondary action. Use coordinates only with a current screenshot when accessibility targeting fails.
- For a popup or web `<select>`, use `set-value` on its element. A background click on these controls is refused because it can open an off-screen menu or wedge input.
- Background input is the default where supported. `--restore-window` takes focus and can move the real pointer; tell the user before using it while they work in another app. Linux and Windows may require foreground input for synthetic actions.
- `action.verification.state=unverified` means the effect is unknown. Inspect the returned snapshot or the destination before reporting success or retrying. Never blindly repeat a click, key, submit, or purchase after a timeout.
- If `result.observationError` is present, the action was delivered but the follow-up observation failed. There is no fresh snapshot. Inspect the app or destination again; do not repeat the action.
- If `element_not_found` or `window_stale` occurs, observe again on the same host and context. If `app_blocked` occurs, stop using Javis on that app.

Use `--text-stdin` and `--value-stdin` for sensitive text so it is absent from shell history. Read or change only what the user requested. Sending messages, submitting forms, purchases, deletions, and account changes require the user's authorization for that action.

If `permission_denied` or `screenshot_failed` names macOS permissions, run `javis permissions status --json` (add `--host <SSH-alias>` for a remote target); have the user complete `javis permissions open` on the host where a grant is missing. On Linux, verify Python 3 with PyGObject/AT-SPI in the active graphical login. On Windows, verify Windows PowerShell UI Automation in the user's interactive desktop. Normal observations do not open System Settings.

Javis Mobile is an explicitly paired HTTPS browser remote for the desktop host; it does not operate phone apps. Orca Mobile has no CUA route. Do not place screenshot bytes, accessibility trees, or input text in diagnostic logs, and never resend an ambiguous mobile action without refreshing the page's observation.
