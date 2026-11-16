# CLI and MCP protocol

## CLI entry points

```text
javis capabilities --json
javis permissions status --json
javis permissions open [--id accessibility|screenshots]
javis list-apps --json
javis list-windows --app <bundle-id|name|pid:N> --json
javis get-app-state --app <app> [--window-id N | --window-index N] [--query TEXT] [--max-elements N] [--no-screenshot] --json
javis click --app <app> --session <sessionId> (--element-index N | --x X --y Y) --json
javis mcp
javis daemon stop
javis agent install codex|claude|all
```

The other action names are `set-value`, `type-text`, `press-key`, `hotkey`, `paste-text`, `scroll`, `drag`, and `perform-secondary-action`. Every action requires `--app` and `--session`. Its target flags are:

| Action | Required action flags | Optional action flags |
| --- | --- | --- |
| `click` | `--element-index N` or `--x X --y Y` | `--click-count N`, `--mouse-button left|right|middle`, `--modifiers CHORD` |
| `set-value` | `--element-index N`, `--value TEXT` or `--value-stdin` | — |
| `type-text`, `paste-text` | `--text TEXT` or `--text-stdin` | — |
| `press-key`, `hotkey` | `--key KEY` | — |
| `scroll` | `--element-index N` or `--x X --y Y`, and `--direction up|down|left|right` | `--pages N` |
| `drag` | `--from-element-index N --to-element-index N` or all of `--from-x`, `--from-y`, `--to-x`, `--to-y` | — |
| `perform-secondary-action` | `--element-index N --action NAME` | — |

`--window-id N` and `--window-index N` are mutually exclusive. `--full-tree` replaces the default action-result tree diff, and `--no-screenshot` skips image capture. `--restore-window` requests foreground input. `--text-stdin` and `--value-stdin` keep sensitive text out of shell history. The CLI parser in `src/cli/parse-call.ts` is the source of truth for validation.

An observation without `--session` creates a UUID. Use `result.sessionId` on the next action; another observation with the same `--session` refreshes it. Actions without a session fail. Window selectors are exclusive. Element indexes are labels from `snapshot.treeText`, may be sparse, and expire after UI changes or two minutes. Coordinates are window-local. Convert screenshot pixels with `actionX = imageX / screenshot.scale` and likewise for Y.

JSON commands use these envelopes (examples omit unrelated snapshot fields):

```json
{"ok":true,"result":{"sessionId":"<uuid>","snapshot":{"id":"<snapshot-id>","treeText":"0 window ...","coordinateSpace":"window","elementCount":1},"screenshot":{"format":"png","path":"<private-temporary-path>","scale":1},"screenshotStatus":{"state":"captured"}}}
```

```json
{"ok":false,"error":{"code":"element_not_found","message":"Refresh getAppState before acting"}}
```

Failed CLI commands exit nonzero. A screenshot can be `captured`, `skipped`, or `failed` independently of the accessibility tree. CLI JSON writes a captured PNG to a mode `0600` temporary path, omits inline `screenshot.data`, and includes an expiry time. Query and element-limit filters change only the returned text; they do not renumber the native elements.

An action that was delivered before a later observation failure is a successful delivery result with an unknown final effect:

```json
{"ok":true,"result":{"sessionId":"<uuid>","action":{"path":"accessibility","delivery":"background","verification":{"state":"unverified","reason":"window_changed"}},"observationError":{"code":"window_not_found","message":"window closed"},"snapshot":null,"screenshot":null}}
```

Do not repeat that action from this response. Inspect the target or destination with a new observation. Ordinary `ok:false` errors occur before delivery or when the action itself fails.

## MCP surface

`javis mcp` speaks MCP over stdio. The 14 tools are `javis_capabilities`, `javis_permissions_status`, `javis_list_apps`, `javis_list_windows`, `javis_get_app_state`, `javis_click`, `javis_set_value`, `javis_type_text`, `javis_press_key`, `javis_hotkey`, `javis_paste_text`, `javis_scroll`, `javis_drag`, and `javis_perform_secondary_action`.

Tool inputs use camelCase JSON fields such as `app`, `windowId`, `elementIndex`, `noScreenshot`, and `restoreWindow`; the session is internal to that MCP process. Each reply includes a JSON text content block. Captured screenshots add an MCP `image/png` block; the text omits PNG base64. Failed calls return an MCP error result with the Javis error code and message. The permission tool reads status only; opening the macOS setup UI is a deliberate CLI operation.

## Internal helper protocol

The daemon sends one JSON object per line to the Swift helper: `{id, method, params, token}`. The helper answers `{id, ok:true, result}` or `{id, ok:false, error:{code,message}}`. `handshake` reports `protocolVersion: 1`; later methods match the runtime action names. The helper socket, token, and controller PID are internal implementation details, not a public API for agents.
