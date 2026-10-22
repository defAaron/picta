"use client"

import { useEffect, useRef } from "react"
import { drawSceneInFrame, sceneFrame } from "@/lib/compose"

export function OnPageView({
  photo,
  scene,
  onClose,
}: {
  photo: Blob
  scene: Blob
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const surface: HTMLCanvasElement = canvas
    let cancelled = false
    let photoBitmap: ImageBitmap | undefined
    let sceneBitmap: ImageBitmap | undefined

    async function draw() {
      const [nextPhoto, nextScene] = await Promise.all([
        createImageBitmap(photo),
        createImageBitmap(scene),
      ])
      if (cancelled) {
        nextPhoto.close()
        nextScene.close()
        return
      }
      photoBitmap = nextPhoto
      sceneBitmap = nextScene
      surface.width = nextPhoto.width
      surface.height = nextPhoto.height
      const ctx = surface.getContext("2d")
      if (!ctx) return
      ctx.drawImage(nextPhoto, 0, 0)
      drawSceneInFrame(ctx, nextScene, sceneFrame(nextPhoto.width, nextPhoto.height))
    }

    void draw().catch(() => {})

    return () => {
      cancelled = true
      photoBitmap?.close()
      sceneBitmap?.close()
    }
  }, [photo, scene])

  return (
    <div>
      <canvas ref={canvasRef} style={{ display: "block", maxWidth: "100%", height: "auto" }} />
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
