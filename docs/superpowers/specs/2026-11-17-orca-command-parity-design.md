# Orca computer command parity

## Reference and scope

The reference is the current Orca checkout at commit `729f757b592244176420a86114c1ea23911eeeba`, with a clean working tree before comparison. Align every command in `src/cli/specs/computer.ts` and its action flags, shared computer contract, and native providers. Preserve the independent Javis daemon, SSH host routing, public JSON envelopes, and authenticated helper. Orca workspace, terminal, browser and orchestration commands belong to its separate product and are outside this desktop CUA command family.

## Changes

Accept `javis computer <command>` for the complete Orca computer command family while retaining Javis flat commands. Map `computer permissions` to explicit local permission setup and `computer permissions status` to status. Both command forms use the same parser, session routing and execution. Help exposes all action flags. Human output includes target identity, screenshot geometry/status, delivery/verification, and a same-target observation command; it never echoes raw action text.

Align CLI query matching and numeric/key/modifier validation with Orca. Align MCP input controls with CLI/RPC: full-tree opt-in, explicit tree-diff selection, positive click counts, correct list-window inputs, and rejection of malformed actions before routing.

Validate observation targets and flags in the runtime as well as the adapters, so direct RPC cannot silently discard malformed targeting or turn a string into foreground restoration. A failed observation in a previously observed session invalidates its indexes and tree baseline. Fresh state is required before the next action. Delivered-action observation failures still preserve their delivery metadata and never cause automatic replay.

Native source comparison should retain existing equivalent implementations. Port only demonstrated gaps and retain the stronger Javis identity, redaction, focus and ambiguous-delivery rules.

Permission setup returns actual status and launch metadata, skips default UI when both grants are complete, and reports unsupported grant states on non-macOS. Repeated pending requests use the newest selection. Unlike Orca's immediate queue acknowledgement, Javis waits through pacing to preserve caller cancellation. Reset and replacement reap only exact same-user permission-setup helper commands, preserving passive status probes and authenticated agent helpers.

## Verification

Use command/argument and output regression tests with fixed expected values, MCP wire tests, runtime target/session tests, Swift and Python provider unit tests, the full TypeScript suite, signed macOS build, and a clean independent-copy build. Desktop mutations and permission UI are excluded from this active graphical session. Windows UI Automation requires Windows CI or an isolated Windows graphical login; macOS tests establish no Windows GUI claim.
