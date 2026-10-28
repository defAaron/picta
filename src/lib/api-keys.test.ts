import { afterEach, describe, expect, it } from "vitest"
import { GEMINI_KEY_HEADER, MAGIC_HOUR_KEY_HEADER, MAX_API_KEY_LENGTH } from "./api-key-headers"
import { geminiConfigured, resolveGeminiKey, resolveMagicHourKey, sceneGemini } from "./api-keys"

const originalGemini = process.env.GEMINI_API_KEY
const originalMagicHour = process.env.MAGIC_HOUR_API_KEY

afterEach(() => {
  if (originalGemini === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalGemini
  if (originalMagicHour === undefined) delete process.env.MAGIC_HOUR_API_KEY
  else process.env.MAGIC_HOUR_API_KEY = originalMagicHour
})

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/scenes", { headers })
}

describe("resolveGeminiKey", () => {
  it("uses a typed key ahead of the server key", () => {
    process.env.GEMINI_API_KEY = "env-key"
    expect(resolveGeminiKey(requestWith({ [GEMINI_KEY_HEADER]: " typed-key " }))).toEqual({
      ok: true,
      apiKey: "typed-key",
    })
  })

  it("uses the server key when the header is missing or blank", () => {
    process.env.GEMINI_API_KEY = " env-key "
    expect(resolveGeminiKey(requestWith({}))).toEqual({ ok: true, apiKey: "env-key" })
    expect(resolveGeminiKey(requestWith({ [GEMINI_KEY_HEADER]: "   " }))).toEqual({
      ok: true,
      apiKey: "env-key",
    })
    expect(geminiConfigured()).toBe(true)
  })

  it("does not fall through to the server key when the typed key is too long", () => {
    process.env.GEMINI_API_KEY = "env-key"
    expect(
      resolveGeminiKey(requestWith({ [GEMINI_KEY_HEADER]: "g".repeat(MAX_API_KEY_LENGTH + 1) })),
    ).toEqual({ ok: false, error: "missing_api_key" })
  })

  it("is missing when neither key is set", () => {
    delete process.env.GEMINI_API_KEY
    expect(resolveGeminiKey(requestWith({}))).toEqual({ ok: false, error: "missing_api_key" })
    expect(geminiConfigured()).toBe(false)
  })
})

describe("sceneGemini", () => {
  it("uses a typed or server key", () => {
    process.env.GEMINI_API_KEY = "env-key"
    expect(sceneGemini(requestWith({ [GEMINI_KEY_HEADER]: "typed-key" }))).toEqual({
      mode: "key",
      apiKey: "typed-key",
    })
    expect(sceneGemini(requestWith({}))).toEqual({ mode: "key", apiKey: "env-key" })
  })

  it("sends the description straight through when no Gemini key exists", () => {
    delete process.env.GEMINI_API_KEY
    expect(sceneGemini(requestWith({}))).toEqual({ mode: "direct" })
    expect(sceneGemini(requestWith({ [GEMINI_KEY_HEADER]: "   " }))).toEqual({ mode: "direct" })
  })

  it("rejects an oversized typed key instead of skipping Gemini", () => {
    process.env.GEMINI_API_KEY = "env-key"
    expect(sceneGemini(requestWith({ [GEMINI_KEY_HEADER]: "g".repeat(MAX_API_KEY_LENGTH + 1) }))).toEqual({
      mode: "invalid",
    })
  })
})

describe("resolveMagicHourKey", () => {
  it("uses only the typed key", () => {
    process.env.MAGIC_HOUR_API_KEY = "env-key"
    expect(resolveMagicHourKey(requestWith({ [MAGIC_HOUR_KEY_HEADER]: " typed-key " }))).toEqual({
      ok: true,
      apiKey: "typed-key",
    })
  })

  it("ignores the server Magic Hour key", () => {
    process.env.MAGIC_HOUR_API_KEY = "env-key"
    expect(resolveMagicHourKey(requestWith({}))).toEqual({ ok: false, error: "missing_api_key" })
  })
})
