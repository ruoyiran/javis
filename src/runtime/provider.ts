export interface JavisProvider {
  call(method: string, params: Record<string, unknown>): Promise<unknown>
  shutdown(): Promise<void>
}
