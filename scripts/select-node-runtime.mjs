import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export function selectNodeRuntime() {
  const candidates = [
    process.env.JAVIS_NODE_PATH,
    process.execPath,
    ...String(process.env.PATH ?? '').split(delimiter).map((directory) => join(directory, 'node'))
  ]
  const seen = new Set()
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate) || !existsSync(candidate)) continue
    seen.add(candidate)
    const probe = spawnSync(candidate, ['-p', '`${process.versions.node} ${process.arch}`'], { encoding: 'utf8' })
    if (probe.status !== 0) continue
    const [version, arch] = probe.stdout.trim().split(' ')
    if (Number(version?.split('.')[0]) >= 24 && arch === process.arch) return candidate
  }
  throw new Error(`A ${process.arch} Node 24 runtime is required to build Javis.app`)
}
