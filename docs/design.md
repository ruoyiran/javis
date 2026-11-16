# Javis design

## Intent and scope

Javis makes macOS desktop control available to local agents without running Orca. The product has three entry points: a human-readable and JSON CLI, an MCP stdio server, and an Agent Skill. The Swift helper retains the macOS computer-use behavior copied from the MIT-licensed Orca source at commit `729f757b592244176420a86114c1ea23911eeeba`.

Version 0.1 targets Apple Silicon and macOS 14 or newer. It supports local GUI apps, multiple windows, accessibility trees, window screenshots, semantic actions, background pointer and keyboard delivery, and explicit foreground fallback. Linux, Windows, remote desktop access, a public JavaScript SDK, Intel Mac packaging, and notarized distribution are outside this version.

## Decisions

| Decision | Reason and consequence |
| --- | --- |
| Separate repository and signed `Javis.app` (`com.royran.javis`) | The project builds without Orca. The stable app identity owns Accessibility and Screen Recording grants across local upgrades. |
| Swift native provider plus TypeScript control layer | Reuses the existing macOS UI behavior and validation while exposing CLI and MCP with one runtime contract. Installation bundles Node, so users need no system Node. |
| On-demand, same-user daemon | Element indexes and tree baselines survive separate CLI calls. Each MCP process has its own session; the daemon serializes native requests. |
| Launch helper with `open -n -g -W` | LaunchServices gives the signed helper its macOS privacy identity while `-g` avoids foreground activation. Directly spawning its binary did not receive the app's grants. |
| Authenticate the helper with controller PID, UID, and random token | LaunchServices is the helper's parent, so parent-PID authentication cannot identify the Node daemon. The socket and token also live in a private directory. |
| Keep the full action result when observation fails | Input may already have been delivered. Returning an ordinary pre-action error would invite unsafe repetition. `observationError` carries the read failure, with no fresh snapshot. |
| Register Agents with a separate command | Installing the app leaves Codex and Claude Code configuration alone until `javis agent install` is requested. Managed Skill hashes permit upgrades without overwriting edits. |

## Behavior contract

The normal loop is observe → act → observe. `get-app-state` creates a session; an action uses that session and a current element index or window-local coordinates. Native accessibility actions are preferred. Synthetic input and clipboard paths report that their effect may be unverified. A semantic value write can be read back; a contradictory readback is a verification error. A changed or missing window causes a fresh observation request, not blind action replay.

`restoreWindow` is explicit because it may take focus and the real pointer. Background input uses private macOS symbols where available. If that route cannot serve the target, Javis reports `background_unavailable` so the caller can decide whether foreground control is appropriate. The helper retains blocked-app checks and secure-value redaction.

## Acceptance and limits

Acceptance requires a clean build from a copy of this repository, passing TypeScript and Swift suites, valid app code signature, a local permission check, a read-only real-window snapshot with image, and an MCP tool call returning text and image. Mutable desktop actions require an isolated graphical session. See [testing](testing.md).

The daemon fails closed if it is killed while holding its short-lived recovery guard; [operations](operations.md) documents manual recovery. A deprecated CoreGraphics window-image fallback remains in the provider alongside ScreenCaptureKit. These are known platform and lifecycle limits, not Orca dependencies.
