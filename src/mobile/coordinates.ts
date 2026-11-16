export type ImagePoint = {
  clientX: number
  clientY: number
  rectWidth: number
  rectHeight: number
  imageWidth: number
  imageHeight: number
  scale: number
}

export function imagePointToWindowPoint(point: ImagePoint): { x: number; y: number } {
  const { clientX, clientY, rectWidth, rectHeight, imageWidth, imageHeight, scale } = point
  if (![clientX, clientY, rectWidth, rectHeight, imageWidth, imageHeight, scale].every(Number.isFinite) ||
    rectWidth <= 0 || rectHeight <= 0 || imageWidth <= 0 || imageHeight <= 0 || scale <= 0 ||
    clientX < 0 || clientX > rectWidth || clientY < 0 || clientY > rectHeight) {
    throw new Error('Invalid screenshot point')
  }
  return {
    x: clientX * imageWidth / rectWidth / scale,
    y: clientY * imageHeight / rectHeight / scale
  }
}
