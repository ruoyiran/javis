export class JavisError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'JavisError' }
}
export { JavisError as RuntimeClientError }
