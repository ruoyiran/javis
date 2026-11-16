export function reportComputerDiagnostic(message: string): void {
  if (process.env.JAVIS_DESKTOP_DIAGNOSTICS === '1') {
    process.stderr.write(`Javis desktop provider: ${message}\n`)
  }
}
