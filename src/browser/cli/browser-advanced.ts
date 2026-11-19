import type { CommandSpec } from './args.js'
import { GLOBAL_FLAGS } from './args.js'
import { withBrowserPageTarget } from './browser-page-target.js'

export const BROWSER_ADVANCED_COMMAND_SPECS: CommandSpec[] = withBrowserPageTarget([
  {
    path: ['extension', 'list'],
    summary: 'List installed browser extensions and their enabled state',
    usage: 'javis browser extension list [--profile <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'profile'],
    notes: ['Desktop only. Defaults to the default browser profile on this Javis host.']
  },
  {
    path: ['extension', 'reload'],
    summary: 'Reload an installed unpacked browser extension',
    usage:
      'javis browser extension reload <extension-id> [--json] | javis browser extension reload --path <folder> [--json]',
    positionalArgs: ['extension-id'],
    allowedFlags: [...GLOBAL_FLAGS, 'extension-id', 'path'],
    notes: [
      'Desktop only. --path selects an already installed unpacked source folder; it never installs one.',
      'Like the Settings reload button, this restarts the extension in every profile where it is enabled.'
    ]
  },
  {
    path: ['cookie', 'get'],
    summary: 'Get cookies for the active tab (optionally filter by URL)',
    usage: 'javis browser cookie get [--url <url>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'url', 'worktree']
  },
  {
    path: ['cookie', 'set'],
    summary: 'Set a cookie',
    usage:
      'javis browser cookie set --name <n> --value <v> [--domain <d>] [--path <p>] [--secure] [--httpOnly] [--sameSite <s>] [--expires <epoch>] [--worktree <selector>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'name',
      'value',
      'domain',
      'path',
      'secure',
      'httpOnly',
      'sameSite',
      'expires',
      'worktree'
    ]
  },
  {
    path: ['cookie', 'delete'],
    destructive: true,
    summary: 'Delete a cookie by name',
    usage:
      'javis browser cookie delete --name <n> [--domain <d>] [--url <u>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'domain', 'url', 'worktree']
  },
  {
    path: ['viewport'],
    summary: 'Set browser viewport size',
    usage:
      'javis browser viewport --width <w> --height <h> [--scale <n>] [--mobile] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'width', 'height', 'scale', 'mobile', 'worktree']
  },
  {
    path: ['geolocation'],
    summary: 'Override browser geolocation',
    usage:
      'javis browser geolocation --latitude <lat> --longitude <lon> [--accuracy <n>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'latitude', 'longitude', 'accuracy', 'worktree']
  },
  {
    path: ['intercept', 'enable'],
    summary: 'Enable request interception (pause matching requests)',
    usage: 'javis browser intercept enable [--patterns <glob,...>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'patterns', 'worktree']
  },
  {
    path: ['intercept', 'disable'],
    summary: 'Disable request interception',
    usage: 'javis browser intercept disable [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['intercept', 'list'],
    summary: 'List paused (intercepted) requests',
    usage: 'javis browser intercept list [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['capture', 'start'],
    summary: 'Start capturing console and network events',
    usage: 'javis browser capture start [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['capture', 'stop'],
    summary: 'Stop capturing console and network events',
    usage: 'javis browser capture stop [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['console'],
    summary: 'Show captured console log entries',
    usage: 'javis browser console [--limit <n>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'limit', 'worktree']
  },
  {
    path: ['network'],
    summary: 'Show captured network requests',
    usage: 'javis browser network [--limit <n>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'limit', 'worktree']
  },
  {
    path: ['dblclick'],
    summary: 'Double-click element by ref',
    usage: 'javis browser dblclick --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree']
  },
  {
    path: ['forward'],
    summary: 'Navigate forward in browser history',
    usage: 'javis browser forward [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['scrollintoview'],
    summary: 'Scroll element into view',
    usage: 'javis browser scrollintoview --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree']
  },
  {
    path: ['get'],
    summary: 'Get element property (text, html, value, url, title, count, box)',
    usage: 'javis browser get --what <property> [--element <ref>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'what', 'element', 'worktree']
  },
  {
    path: ['is'],
    summary: 'Check element state (visible, enabled, checked)',
    usage: 'javis browser is --what <state> --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'what', 'element', 'worktree']
  },
  {
    path: ['inserttext'],
    summary: 'Insert text without key events',
    usage: 'javis browser inserttext --text <text> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text', 'worktree']
  },
  {
    path: ['mouse', 'move'],
    summary: 'Move mouse to x,y coordinates',
    usage: 'javis browser mouse move --x <n> --y <n> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'x', 'y', 'worktree']
  },
  {
    path: ['mouse', 'down'],
    summary: 'Press mouse button',
    usage: 'javis browser mouse down [--button <left|right|middle>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'button', 'worktree']
  },
  {
    path: ['mouse', 'up'],
    summary: 'Release mouse button',
    usage: 'javis browser mouse up [--button <left|right|middle>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'button', 'worktree']
  },
  {
    path: ['mouse', 'wheel'],
    summary: 'Scroll wheel',
    usage: 'javis browser mouse wheel --dy <n> [--dx <n>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'dy', 'dx', 'worktree']
  },
  {
    path: ['find'],
    summary: 'Find element by semantic locator and perform action',
    usage:
      'javis browser find --locator <type> --value <text> --action <action> [--text <text>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'locator', 'value', 'action', 'text', 'worktree']
  },
  {
    path: ['set', 'device'],
    summary: 'Emulate a device',
    usage: 'javis browser set device --name <device> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'worktree']
  },
  {
    path: ['set', 'offline'],
    summary: 'Toggle offline mode',
    usage: 'javis browser set offline [--state <on|off>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'state', 'worktree']
  },
  {
    path: ['set', 'headers'],
    summary: 'Set extra HTTP headers',
    usage: 'javis browser set headers --headers <json> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'headers', 'worktree']
  },
  {
    path: ['set', 'credentials'],
    summary: 'Set HTTP auth credentials',
    usage: 'javis browser set credentials --user <user> --pass <pass> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'user', 'pass', 'worktree']
  },
  {
    path: ['set', 'media'],
    summary:
      'Set color scheme and reduced motion preferences (omitted ones reset to no preference)',
    usage:
      'javis browser set media [--color-scheme <dark|light>] [--reduced-motion <reduce|no-preference>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'color-scheme', 'reduced-motion', 'worktree']
  },
  {
    path: ['clipboard', 'read'],
    summary: 'Read clipboard contents',
    usage: 'javis browser clipboard read [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['clipboard', 'write'],
    summary: 'Write text to clipboard',
    usage: 'javis browser clipboard write --text <text> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text', 'worktree']
  },
  {
    path: ['dialog', 'accept'],
    summary: 'Accept a browser dialog',
    usage: 'javis browser dialog accept [--text <text>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text', 'worktree']
  },
  {
    path: ['dialog', 'dismiss'],
    summary: 'Dismiss a browser dialog',
    usage: 'javis browser dialog dismiss [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['storage', 'local', 'get'],
    summary: 'Get a localStorage value by key',
    usage: 'javis browser storage local get --key <key> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key', 'worktree']
  },
  {
    path: ['storage', 'local', 'set'],
    summary: 'Set a localStorage value',
    usage: 'javis browser storage local set --key <key> --value <value> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key', 'value', 'worktree']
  },
  {
    path: ['storage', 'local', 'clear'],
    destructive: true,
    summary: 'Clear all localStorage',
    usage: 'javis browser storage local clear [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['storage', 'session', 'get'],
    summary: 'Get a sessionStorage value by key',
    usage: 'javis browser storage session get --key <key> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key', 'worktree']
  },
  {
    path: ['storage', 'session', 'set'],
    summary: 'Set a sessionStorage value',
    usage: 'javis browser storage session set --key <key> --value <value> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key', 'value', 'worktree']
  },
  {
    path: ['storage', 'session', 'clear'],
    destructive: true,
    summary: 'Clear all sessionStorage',
    usage: 'javis browser storage session clear [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['download'],
    summary: 'Download a file by clicking a selector',
    usage: 'javis browser download --selector <ref> --path <path> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'selector', 'path', 'worktree']
  },
  {
    path: ['highlight'],
    summary: 'Highlight an element by selector',
    usage: 'javis browser highlight --selector <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'selector', 'worktree']
  }
])
