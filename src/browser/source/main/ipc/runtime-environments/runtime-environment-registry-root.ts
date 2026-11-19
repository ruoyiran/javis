import { app } from 'electron'
export function getRuntimeEnvironmentRegistryRoot(): string { return app.getPath('userData') }
