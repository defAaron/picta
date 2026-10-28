import { describe, expect, it } from "vitest"
import { parseIllustrateResult } from "./illustrate-schema"

describe("illustrate schema", () => {
  it("accepts a valid object with a null reject reason and an extra field", () => {
    expect(parseIllustrateResult({
      allowed: true,
      rejectReason: null,
      moment: "A lantern in a stairwell",
      imagePrompt: "A child holding a lantern on stone stairs",
      unused: "ignore me",
    })).toEqual({
      ok: true,
      result: {
        allowed: true,
        rejectReason: null,
        moment: "A lantern in a stairwell",
        imagePrompt: "A child holding a lantern on stone stairs",
      },
    })
  })

  it("treats a missing reject reason as null", () => {
    expect(parseIllustrateResult({
      allowed: true,
      moment: "A lantern in a stairwell",
      imagePrompt: "A child holding a lantern on stone stairs",
    })).toEqual({
      ok: true,
      result: {
        allowed: true,
        rejectReason: null,
        moment: "A lantern in a stairwell",
        imagePrompt: "A child holding a lantern on stone stairs",
      },
    })
  })

  it("rejects a missing imagePrompt field", () => {
    expect(parseIllustrateResult({
      allowed: true,
      rejectReason: null,
      moment: "A lantern in a stairwell",
    })).toEqual({ ok: false })
  })

  it("rejects a string body", () => {
    expect(parseIllustrateResult("not an object")).toEqual({ ok: false })
  })

  it("rejects a number moment", () => {
    expect(parseIllustrateResult({
      allowed: true,
      rejectReason: null,
      moment: 12,
      imagePrompt: "A child holding a lantern on stone stairs",
    })).toEqual({ ok: false })
  })
})
