export const BROWSER_FLAG_HELP_TEXT: Record<string, string> = {
  "help": "--help                 Show this help message",
  "json": "--json                 Emit machine-readable JSON",
  "worktree": "--worktree <selector>  Browser context namespace, or all for no workspace filter",
  "session": "--session <namespace>  Alias for --context",
  "mode": "--mode <mode>          Mode such as edit, diff, or both",
  "url": "--url <url>            URL to navigate to",
  "depth": "--depth <n>            Child issue depth for --children/--full",
  "full": "--full                 Include all supported V1 issue context within caps",
  "page": "--page <id>            Stable browser page id from `javis browser tab list --json`",
  "format": "--format <png|jpeg>    Screenshot image format",
  "element": "--element <ref>        Element ref from snapshot (e.g. e3)",
  "expect-url": "--expect-url <url>     Fail before acting unless the page is at this exact absolute URL",
  "value": "--value <text>         Value to fill or select",
  "input": "--input <text>         Text to type at current focus",
  "direction": "--direction <dir>      Direction: up|down|left|right for scroll, horizontal|vertical for split",
  "amount": "--amount <pixels>      Scroll distance in pixels",
  "expression": "--expression <js>     JavaScript expression to evaluate",
  "text": "--text <text>          Text payload to send or type",
  "key": "--key <key>            Key argument for this command",
  "show-profile": "--show-profile        Include tab profile in text output",
  "index": "--index <n>            Tab index to switch to",
  "focus": "--focus                Reveal the created terminal session in Javis",
  "profile": "--profile <id>        Browser profile id",
  "command": "--command <text>       Command to run in the terminal on startup",
  "path": "--path <path>          Path argument for the command",
  "name": "--name <name>          Name for the new worktree or automation",
  "limit": "--limit <n>            Maximum number of rows to return",
  "action": "--action <name>       Secondary accessibility action name",
  "host": "--host <alias>         SSH alias for the Javis browser host",
  "context": "--context <namespace>  Explicit folder or session namespace on the selected host"
}

export const BROWSER_COMMAND_FLAG_HELP: Record<string, Record<string, string>> = {
  "snapshot": {
    "interactive": "--interactive          Only interactive elements (buttons, inputs, links); no page text",
    "compact": "--compact              Drop empty structural nodes",
    "depth": "--depth <n>            Limit the tree to n levels",
    "selector": "--selector <css>       Snapshot only the element matching this CSS selector",
    "urls": "--urls                 Include link URLs",
    "delta": "--delta                Return only what changed since the last --delta snapshot",
    "full": "--full                 Return the whole tree and reset the --delta baseline"
  },
  "screenshot": {
    "if-changed": "--if-changed           Skip saving when the page looks the same as the last capture",
    "annotate": "--annotate             Label interactive elements; label [N] is ref @eN"
  },
  "wait": {
    "url": "--url <pattern>        Wait until the page URL contains this text or matches a glob",
    "selector": "--selector <sel>       Wait for an element by ref or CSS selector",
    "timeout": "--timeout <ms>         How long to wait for the condition, or a plain pause",
    "text": "--text <text>          Wait until this text appears on the page",
    "load": "--load <state>         Wait for load or domcontentloaded (networkidle only on quiet pages)",
    "fn": "--fn <js>              Wait until this JavaScript expression is truthy",
    "state": "--state <state>        With --selector, wait for hidden or visible"
  },
  "exec": {
    "command": "--command <text>       agent-browser command and arguments, e.g. \"get text @e3\""
  },
  "extension reload": {
    "extension-id": "--extension-id <id>   Installed unpacked extension ID; also accepted positionally",
    "path": "--path <folder>        Source folder of exactly one installed unpacked extension"
  },
  "download": {
    "selector": "--selector <ref>       Element ref or CSS selector of the download link",
    "path": "--path <path>          File path to save the download to"
  }
}
