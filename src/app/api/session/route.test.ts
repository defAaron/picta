import { describe, expect, it } from "vitest"
import { POST, runtime } from "./route"

function sessionCookie(response: Response): string {
  const line = response.headers.getSetCookie().find((value) => value.startsWith("picta_sid="))
  expect(line).toBeDefined()
  return line ?? ""
}

function sessionId(setCookie: string): string {
  const pair = setCookie.split(";")[0] ?? ""
  return pair.slice("picta_sid=".length)
}

describe("POST /api/session", () => {
  it("runs on the nodejs runtime", () => {
    expect(runtime).toBe("nodejs")
  })

  it("sets picta_sid on http and keeps that id on the next post", async () => {
    const first = await POST(new Request("http://localhost/api/session", { method: "POST" }))
    expect(await first.json()).toEqual({ ok: true })

    const setCookie = sessionCookie(first)
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie.toLowerCase()).toContain("samesite=lax")
    expect(setCookie).toMatch(/(?:^|; )Path=\/(?:;|$)/)
    expect(setCookie).toContain("Max-Age=2592000")
    expect(setCookie).not.toMatch(/(?:^|; )Secure(?:;|$)/)

    const id = sessionId(setCookie)
    expect(id).toMatch(/^[0-9a-f]{64}$/)

    const second = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { cookie: `picta_sid=${id}` },
      }),
    )
    expect(await second.json()).toEqual({ ok: true })
    expect(second.headers.getSetCookie().some((value) => value.startsWith("picta_sid="))).toBe(false)
  })

  it("sets Secure when the request URL is https", async () => {
    const response = await POST(new Request("https://localhost/api/session", { method: "POST" }))
    const setCookie = sessionCookie(response)
    expect(setCookie).toMatch(/(?:^|; )Secure(?:;|$)/)
    expect(sessionId(setCookie)).toMatch(/^[0-9a-f]{64}$/)
  })
})
