// Javis owns no Orca telemetry enrollment or transport.
export const isTelemetryInitialized = (): boolean => false
export const isTelemetryEnabled = (): boolean => false
export function track(_name: string, _props: unknown): boolean { return false }
export function initTelemetry(..._args: unknown[]): void {}
export function trackAppOpenedOnce(): void {}
export async function shutdownTelemetry(): Promise<void> {}
export async function persistBannerAcknowledgeWithoutEmitting(): Promise<void> {}
export async function setOptIn(..._args: unknown[]): Promise<void> { throw new Error('Orca telemetry is unavailable in Javis') }
