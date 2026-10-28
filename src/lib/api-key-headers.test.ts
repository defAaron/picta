import { describe, expect, it } from "vitest"
import { canSubmitKeys, MAX_API_KEY_LENGTH, usableApiKey } from "./api-key-headers"

describe("canSubmitKeys", () => {
  it("accepts a typed Gemini key and a Magic Hour key", () => {
    expect(
      canSubmitKeys({
        geminiDraft: " gemini-key ",
        magicHourDraft: " magic-key ",
        geminiConfigured: false,
        requireTypedGemini: false,
      }),
    ).toBe(true)
    expect(usableApiKey(" gemini-key ")).toBe("gemini-key")
  })

  it("allows a blank Gemini key when the server has one", () => {
    expect(
      canSubmitKeys({
        geminiDraft: "   ",
        magicHourDraft: "magic-key",
        geminiConfigured: true,
        requireTypedGemini: false,
      }),
    ).toBe(true)
  })

  it("keeps the form up when Gemini is blank and the server has no key", () => {
    expect(
      canSubmitKeys({
        geminiDraft: "",
        magicHourDraft: "magic-key",
        geminiConfigured: false,
        requireTypedGemini: false,
      }),
    ).toBe(false)
  })

  it("allows a blank Gemini key when the scene can go straight to Magic Hour", () => {
    expect(
      canSubmitKeys({
        geminiDraft: "",
        magicHourDraft: "magic-key",
        geminiConfigured: false,
        requireTypedGemini: false,
        geminiRequired: false,
      }),
    ).toBe(true)
  })

  it("requires a typed Gemini key after the server key is rejected", () => {
    expect(
      canSubmitKeys({
        geminiDraft: "",
        magicHourDraft: "magic-key",
        geminiConfigured: true,
        requireTypedGemini: true,
      }),
    ).toBe(false)
  })

  it("rejects a blank or oversized Magic Hour key", () => {
    expect(
      canSubmitKeys({
        geminiDraft: "gemini-key",
        magicHourDraft: " ",
        geminiConfigured: true,
        requireTypedGemini: false,
      }),
    ).toBe(false)
    expect(
      canSubmitKeys({
        geminiDraft: "gemini-key",
        magicHourDraft: "m".repeat(MAX_API_KEY_LENGTH + 1),
        geminiConfigured: true,
        requireTypedGemini: false,
      }),
    ).toBe(false)
  })
})
