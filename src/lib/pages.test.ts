import { describe, expect, it } from "vitest"
import { joinPages, splitPageAt, splitPaste } from "./pages"

describe("splitPaste", () => {
  it("rejects an empty paste", () => {
    expect(splitPaste("  \n")).toEqual({ ok: false, reason: "empty" })
  })

  it("rejects more than 20000 characters", () => {
    expect(splitPaste("a".repeat(20001))).toEqual({ ok: false, reason: "too_long" })
  })

  it("keeps a short paste as one page", () => {
    expect(splitPaste("Hello.")).toEqual({ ok: true, pages: ["Hello."] })
  })

  it("splits on a line that is only ---", () => {
    expect(splitPaste("One\n---\nTwo")).toEqual({ ok: true, pages: ["One", "Two"] })
  })

  it("packs paragraphs that fit in 2500 characters", () => {
    const a = "a".repeat(2000)
    const b = "b".repeat(400)
    expect(splitPaste(`${a}\n\n${b}`)).toEqual({ ok: true, pages: [`${a}\n\n${b}`] })
  })

  it("starts a new page when the next paragraph would pass 2500", () => {
    const a = "a".repeat(2000)
    const b = "b".repeat(600)
    expect(splitPaste(`${a}\n\n${b}`)).toEqual({ ok: true, pages: [a, b] })
  })

  it("keeps one long paragraph together", () => {
    const block = "a".repeat(2501)
    expect(splitPaste(block)).toEqual({ ok: true, pages: [block] })
  })

  it("refuses a ninth page", () => {
    const text = Array.from({ length: 9 }, (_, i) => `Page ${i}`).join("\n---\n")
    expect(splitPaste(text)).toEqual({ ok: false, reason: "too_many_pages" })
  })
})

describe("joinPages", () => {
  it("joins with a blank line", () => {
    expect(joinPages("One", "Two")).toEqual({ ok: true, text: "One\n\nTwo" })
  })

  it("rejects a join over 5000 characters", () => {
    expect(joinPages("a".repeat(2500), "b".repeat(2500))).toEqual({
      ok: false,
      reason: "too_long",
    })
  })
})

describe("splitPageAt", () => {
  it("splits at the cursor", () => {
    expect(splitPageAt("abcdef", 3)).toEqual({ ok: true, left: "abc", right: "def" })
  })

  it("rejects a split that would leave an empty side", () => {
    expect(splitPageAt("abcdef", 0)).toEqual({ ok: false, reason: "empty_side" })
  })
})
