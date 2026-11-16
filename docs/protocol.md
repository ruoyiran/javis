# CLI, MCP, and gateway protocol

For end-to-end workflows using these commands, see the [usage examples](examples.md).

## CLI entry points

```text
javis capabilities [--host <SSH-alias>] --json
javis permissions status [--host <SSH-alias>] --json
javis permissions open [--id accessibility|screenshots]
javis permissions reset
javis list-apps [--host <SSH-alias>] --json
javis list-windows --app <bundle-id|name|pid:N> [--host <SSH-alias>] --json
javis get-app-state --app <app> [--host <SSH-alias>] [--session ID | --worktree ID] [--window-id N | --window-index N] [--query TEXT] [--max-elements N] [--no-screenshot] --json
javis click --app <app> [--host <SSH-alias>] [--session ID | --worktree ID] (--element-index N | --x X --y Y) --json
javis mcp
javis rpc --stdio
javis settings serve|open [--port N]
javis mobile serve [--bind IP] [--port N] [--cert PEM --key PEM]
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

`--window-id N` and `--window-index N` are mutually exclusive, as are `--session ID` and `--worktree ID`. `--full-tree` replaces the default action-result tree diff, and `--no-screenshot` skips image capture. `--restore-window` requests foreground input where supported. `--text-stdin` and `--value-stdin` keep sensitive text out of shell history. The CLI parser in `src/cli/parse-call.ts` is the source of truth for validation.

An observation with `--session` refreshes that explicit session; use the returned `result.sessionId` on a later action. Alternatively, use the same `--worktree` value for observation and action. Without either flag, the CLI derives a context from its canonical current directory; ordinary folders work, not only Git worktrees. The context is a session namespace on the selected host, not a host or desktop selector. Element indexes are labels from `snapshot.treeText`, may be sparse, and expire after UI changes or two minutes. An indexed action without a fresh observation in the same host/context fails. Coordinates are window-local. Convert screenshot pixels with `actionX = imageX / screenshot.scale` and likewise for Y.

JSON commands use these envelopes (examples omit unrelated snapshot fields):

```json
{"ok":true,"result":{"sessionId":"<uuid>","snapshot":{"id":"<snapshot-id>","treeText":"0 window ...","coordinateSpace":"window","elementCount":1},"screenshot":{"format":"png","path":"<private-temporary-path>","scale":1},"screenshotStatus":{"state":"captured"}}}
```

```json
{"ok":false,"error":{"code":"element_not_found","message":"Refresh getAppState before acting","nextSteps":["Run javis get-app-state --app <app> --json in the same host and context, then select an element index from the fresh tree."]}}
```

Failed CLI commands exit nonzero. `error.nextSteps` contains concrete recovery instructions for recognized error codes and is empty for unknown codes. A screenshot can be `captured`, `skipped`, or `failed` independently of the accessibility tree. CLI JSON normally writes a captured PNG to a private temporary path (`0600` on Unix), omits inline `screenshot.data`, and includes an expiry time. If temporary-file creation fails, it preserves inline data and includes a recoverable warning; callers must not assume a path exists. Query and element-limit filters change only the returned text; they do not renumber the native elements. A remote screenshot is materialized on the caller, never returned as a remote path.

An action that was delivered before a later observation failure is a successful delivery result with an unknown final effect:

```json
{"ok":true,"result":{"sessionId":"<uuid>","action":{"path":"accessibility","delivery":"background","verification":{"state":"unverified","reason":"window_changed"}},"observationError":{"code":"window_not_found","message":"window closed"},"snapshot":null,"screenshot":null}}
```

Do not repeat that action from this response. Inspect the target or destination with a new observation. Ordinary `ok:false` errors occur before delivery or when the action itself fails.

## MCP surface

`javis mcp` speaks MCP over stdio. The 14 tools are `javis_capabilities`, `javis_permissions_status`, `javis_list_apps`, `javis_list_windows`, `javis_get_app_state`, `javis_click`, `javis_set_value`, `javis_type_text`, `javis_press_key`, `javis_hotkey`, `javis_paste_text`, `javis_scroll`, `javis_drag`, and `javis_perform_secondary_action`.

`javis_permissions_status` accepts an optional `host` SSH alias. It reads the selected host's macOS permission state through the allowlisted stdio bridge. Local status, setup, and reset share the long-lived daemon's paced permission gate; remote setup and reset require an explicit command on the remote host.

Tool inputs use camelCase JSON fields such as `app`, `windowId`, `elementIndex`, `noScreenshot`, and `restoreWindow`. Computer tools accept optional `host` and `worktree`; MCP keeps a separate session per connection, host, and worktree. A worktree never selects an SSH host. Each reply includes a JSON text content block. Captured screenshots add an MCP `image/png` block; the text omits PNG base64. Failed calls return an MCP error result with the Javis error code, message, and concrete next steps for recognized codes. The permission tool reads status only; opening the macOS setup UI is a deliberate CLI or local settings operation.

## SSH and mobile gateway

`--host <SSH-alias>` selects an explicit remote Javis installation. The client runs `ssh -T <alias> javis rpc --stdio`; the alias must contain no command options or whitespace. The bridge accepts one newline-framed `{id,method,params}` request and returns one `{id,ok,result|error}` response. It only permits the declared computer methods; SSH host verification and authentication are delegated to OpenSSH. A timeout, disconnect, or malformed reply can mean an action was delivered. Inspect the target before another action, and do not automatically retry. Javis does not publish its daemon or helper endpoint on TCP.

`javis mobile serve` starts a separate gateway on the desktop to be controlled. Non-loopback binds require a TLS certificate and key. The printed pairing code is one-time and valid for five minutes. A paired browser gets an HttpOnly, SameSite=Strict cookie (Secure over HTTPS; omitted for loopback HTTP); protected mutation endpoints require same-origin and CSRF checks. The page chooses an app and window, gets a fresh observation, and can submit any of the nine actions. The gateway binds the selected target and session per device and accepts only action-specific parameters from the browser. A tap is converted from displayed CSS pixels to screenshot pixels, then divided by `screenshot.scale` for window-local points. After an uncertain action result, the page requires a new observation before another action. It controls desktop apps, not apps on the phone.

## Internal helper protocol

On macOS the daemon sends one JSON object per line to the Swift helper: `{id, method, params, token}`. The helper answers `{id, ok:true, result}` or `{id, ok:false, error:{code,message}}`. `handshake` reports `protocolVersion: 1`; later methods match the runtime action names. Linux and Windows providers translate their native script protocol to the same Javis result types. Helper sockets, daemon endpoints, tokens, and controller identity are internal implementation details, not public agent APIs.
