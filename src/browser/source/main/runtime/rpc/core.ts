import type { ZodType } from 'zod'
export type RpcMethod = { name: string; permission: string; params: ZodType | null; handler: (params: any, context: any, emit: (event: any) => void) => any }
export type RpcStreamingMethod = RpcMethod
export type RpcAnyMethod = RpcMethod
export type RpcContext = Record<string, any>
export function defineMethod<T extends RpcMethod>(method: T): T { return method }
export function defineStreamingMethod<T extends RpcMethod>(method: T): T & { streaming: true } { return { ...method, streaming: true } }
export class InvalidArgumentError extends Error { readonly code = 'invalid_argument' }
