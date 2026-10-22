export function sceneFrame(photoWidth: number, photoHeight: number): {
  x: number
  y: number
  width: number
  height: number
} {
  const width = photoWidth * 0.84
  const height = photoHeight * 0.42
  return {
    x: photoWidth * 0.08,
    y: photoHeight - height,
    width,
    height,
  }
}

type Frame = ReturnType<typeof sceneFrame>

type SceneCanvas = {
  save(): void
  restore(): void
  shadowBlur: number
  shadowColor: string
  shadowOffsetX: number
  shadowOffsetY: number
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
}

export function drawSceneInFrame(ctx: SceneCanvas, scene: CanvasImageSource, frame: Frame): void {
  ctx.save()
  ctx.shadowBlur = 24
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)"
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 8
  ctx.drawImage(scene, frame.x, frame.y, frame.width, frame.height)
  ctx.restore()
}

export async function composePage(photo: ImageBitmap, scene: ImageBitmap): Promise<Blob> {
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas is unavailable.")
  }
  const canvas = new OffscreenCanvas(photo.width, photo.height)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not draw the page.")
  ctx.drawImage(photo, 0, 0)
  drawSceneInFrame(ctx, scene, sceneFrame(photo.width, photo.height))
  return canvas.convertToBlob({ type: "image/png" })
}
