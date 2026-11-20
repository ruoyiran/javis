import { setTimeout } from 'node:timers/promises'

export async function waitForBrowserFixtureState(condition, description, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`)
    await setTimeout(100)
  }
}
