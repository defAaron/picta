import { afterEach, describe, expect, it } from "vitest"
import { clientIp } from "./client-ip"

const originalTrustedProxy = process.env.TRUSTED_PROXY

afterEach(() => {
  if (originalTrustedProxy === undefined) {
    delete process.env.TRUSTED_PROXY
  } else {
    process.env.TRUSTED_PROXY = originalTrustedProxy
  }
})

function headersWithForwarded(value: string): Headers {
  return new Headers({ "X-Forwarded-For": value })
}

describe("clientIp", () => {
  it("ignores X-Forwarded-For when TRUSTED_PROXY is unset", () => {
    delete process.env.TRUSTED_PROXY
    expect(clientIp(headersWithForwarded("1.2.3.4"), "9.9.9.9")).toBe("9.9.9.9")
  })

  it("uses the leftmost X-Forwarded-For value when TRUSTED_PROXY is true", () => {
    process.env.TRUSTED_PROXY = "true"
    expect(clientIp(headersWithForwarded("1.2.3.4"), "9.9.9.9")).toBe("1.2.3.4")
  })

  it("returns unknown for a null socket when untrusted", () => {
    delete process.env.TRUSTED_PROXY
    expect(clientIp(new Headers(), null)).toBe("unknown")
  })

  it("returns only the leftmost address from a comma-separated list when trusted", () => {
    process.env.TRUSTED_PROXY = "true"
    expect(clientIp(headersWithForwarded("1.2.3.4, 5.6.7.8"), "9.9.9.9")).toBe("1.2.3.4")
  })

  it("ignores X-Forwarded-For when TRUSTED_PROXY is false or 1", () => {
    process.env.TRUSTED_PROXY = "false"
    expect(clientIp(headersWithForwarded("1.2.3.4"), "9.9.9.9")).toBe("9.9.9.9")

    process.env.TRUSTED_PROXY = "1"
    expect(clientIp(headersWithForwarded("1.2.3.4"), "9.9.9.9")).toBe("9.9.9.9")
  })

  it("falls back to the socket when the trusted header is missing or blank", () => {
    process.env.TRUSTED_PROXY = "true"
    expect(clientIp(new Headers(), "9.9.9.9")).toBe("9.9.9.9")
    expect(clientIp(headersWithForwarded("  ,  "), "9.9.9.9")).toBe("9.9.9.9")
    expect(clientIp(headersWithForwarded(""), null)).toBe("unknown")
  })

  it("returns unknown for an empty socket when untrusted", () => {
    delete process.env.TRUSTED_PROXY
    expect(clientIp(headersWithForwarded("1.2.3.4"), "")).toBe("unknown")
  })
})
