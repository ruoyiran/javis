import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateExistingJavisApp } from '../../scripts/install-local-policy.mjs'

it('refuses to replace an app whose bundle ID belongs to another product', () => {
  const root = mkdtempSync(join(tmpdir(), 'javis-existing-app-'))
  try {
    const app = join(root, 'Javis.app')
    mkdirSync(join(app, 'Contents'), { recursive: true })
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>com.example.unrelated</string></dict></plist>')
    expect(() => validateExistingJavisApp(app)).toThrow(/unrelated.*app/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
