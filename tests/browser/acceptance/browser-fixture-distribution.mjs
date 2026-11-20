import { join, resolve } from 'node:path'

export const browserFixtureDistribution = resolve(process.env.JAVIS_BROWSER_ACCEPTANCE_DIST ?? 'dist')
export const browserFixtureCli = join(browserFixtureDistribution, 'cli.cjs')
export const browserFixtureApplication = join(browserFixtureDistribution, 'browser')
export const browserFixtureElectron = join(browserFixtureApplication, 'electron', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron')
