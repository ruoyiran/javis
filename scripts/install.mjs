if (process.platform === 'darwin') await import('./install-local.mjs')
else if (process.platform === 'linux' || process.platform === 'win32') await import('./install-desktop.mjs')
else throw new Error(`Javis does not support ${process.platform}`)
