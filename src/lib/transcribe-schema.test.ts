import { describe, expect, it } from "vitest"
import { parseTranscribeResult } from "./transcribe-schema"

describe("transcribe schema", () => {
  it("accepts a valid object with a null reject reason and an extra field", () => {
    expect(parseTranscribeResult({
      accepted: true,
      rejectReason: null,
      singlePage: true,
      text: "Once upon a time",
      unused: "ignore me",
    })).toEqual({
      ok: true,
      result: {
        accepted: true,
        rejectReason: null,
        singlePage: true,
        text: "Once upon a time",
      },
    })
  })

  it("rejects a missing text field", () => {
    expect(parseTranscribeResult({
      accepted: true,
      rejectReason: null,
      singlePage: true,
    })).toEqual({ ok: false })
  })

  it("rejects a string body", () => {
    expect(parseTranscribeResult("not an object")).toEqual({ ok: false })
  })
})
