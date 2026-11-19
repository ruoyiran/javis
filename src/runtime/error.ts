export class JavisError extends Error {
  constructor(public readonly code: string, message: string, public readonly data?: unknown) { super(message); this.name = 'JavisError' }
}
export { JavisError as RuntimeClientError }

export function runtimeErrorDetails(error: unknown, fallback = 'internal_error'): { code: string; message: string; data?: unknown } {
  const value = error as { code?: unknown; message?: unknown; data?: unknown } | null
  return {
    code: typeof value?.code === 'string' ? value.code : fallback,
    message: typeof value?.message === 'string' ? value.message : String(error),
    ...(value?.data !== undefined ? { data: value.data } : {})
  }
}
