import { describe, expect, it } from "vitest"
import { composePage, sceneFrame } from "./compose"

describe("sceneFrame", () => {
  it("insets each side by 8% and fills the lower 42% of the photo", () => {
    expect(sceneFrame(1000, 2000)).toEqual({
      x: 80,
      y: 1160,
      width: 840,
      height: 840,
    })
  })
})

const canCompose =
  typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap === "function"

describe.skipIf(!canCompose)("composePage", () => {
  it("returns a png blob", async () => {
    const photo = await solidBitmap(10, 20, "#ffffff")
    const scene = await solidBitmap(4, 4, "#224466")
    try {
      const blob = await composePage(photo, scene)
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe("image/png")
    } finally {
      photo.close()
      scene.close()
    }
  })
})

async function solidBitmap(width: number, height: number, color: string): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not prepare the test canvas.")
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  return createImageBitmap(canvas)
}
