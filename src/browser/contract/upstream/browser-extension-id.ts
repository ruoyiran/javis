const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/
export function isChromeExtensionId(value: unknown): value is string {
  return typeof value === 'string' && CHROME_EXTENSION_ID_PATTERN.test(value)
}
