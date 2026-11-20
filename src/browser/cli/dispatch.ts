import type { RuntimeClient } from './runtime-client.js'
export type HandlerContext = { flags: Map<string, string | boolean>; client: RuntimeClient; cwd: string; json: boolean; stdin?: () => Promise<string> }
export type CommandHandler = (context: HandlerContext) => Promise<void>
