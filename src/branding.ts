import logoSvg from '../assets/branding/javis.svg?raw'

// Embed the canonical artwork so installed pages do not depend on a source checkout.
export const javisLogoDataUrl = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`
export const javisLogoMarkup = logoSvg.replace('<svg ', '<svg aria-hidden="true" focusable="false" ')
