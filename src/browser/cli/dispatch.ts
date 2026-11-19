import type { RuntimeClient } from './runtime-client.js'
export type HandlerContext = { flags: Map<string, string | boolean>; client: RuntimeClient; cwd: string; json: boolean }
export type CommandHandler = (context: HandlerContext) => Promise<void>
