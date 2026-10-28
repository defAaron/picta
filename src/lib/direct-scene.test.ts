import { describe, expect, it } from "vitest"
import { directScenePrompt, MAX_DIRECT_PROMPT } from "./direct-scene"

describe("directScenePrompt", () => {
  it("collapses whitespace and keeps a short description", () => {
    expect(directScenePrompt("Mice\n\nin   the margin.")).toEqual({
      ok: true,
      prompt: "Mice in the margin.",
      moment: "Mice in the margin.",
    })
  })

  it("keeps a 1,500 character description and shortens the moment", () => {
    const prompt = "a".repeat(MAX_DIRECT_PROMPT)
    expect(directScenePrompt(prompt)).toEqual({
      ok: true,
      prompt,
      moment: "a".repeat(200),
    })
  })

  it("refuses a description longer than 1,500 characters", () => {
    expect(directScenePrompt("a".repeat(MAX_DIRECT_PROMPT + 1))).toEqual({
      ok: false,
      reason: "Without a Gemini key, keep the description to 1,500 characters.",
    })
  })

  it("refuses an empty description", () => {
    expect(directScenePrompt("  \n  ")).toEqual({
      ok: false,
      reason: "That page could not be illustrated.",
    })
  })
})
