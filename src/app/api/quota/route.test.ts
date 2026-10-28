import { afterEach, describe, expect, it } from "vitest"
import { clientIp } from "../../../lib/client-ip"
import { remainingWindow, takeWindow } from "../../../lib/limits"
import { GET, limitsForTests, runtime } from "./route"

const DAY_MS = 24 * 60 * 60 * 1000
const originalTrustedProxy = process.env.TRUSTED_PROXY
const originalGemini = process.env.GEMINI_API_KEY

afterEach(() => {
  if (originalTrustedProxy === undefined) {
    delete process.env.TRUSTED_PROXY
  } else {
    process.env.TRUSTED_PROXY = originalTrustedProxy
  }
  if (originalGemini === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalGemini
})

function windowCount(): number {
  const row = limitsForTests().prepare("select count(*) as n from windows").get() as { n: number }
  return row.n
}

function sessionIdFrom(response: Response): string {
  const line = response.headers.getSetCookie().find((value) => value.startsWith("picta_sid="))
  expect(line).toBeDefined()
  const pair = (line ?? "").split(";")[0] ?? ""
  const id = pair.slice("picta_sid=".length)
  expect(id).toMatch(/^[0-9a-f]{64}$/)
  return id
}

describe("GET /api/quota", () => {
  it("runs on the nodejs runtime", () => {
    expect(runtime).toBe("nodejs")
  })

  it("reads the same remaining window twice without spending it", async () => {
    delete process.env.TRUSTED_PROXY
    delete process.env.GEMINI_API_KEY
    const before = windowCount()

    const first = await GET(new Request("http://localhost/api/quota"))
    const firstBody = await first.json()
    const id = sessionIdFrom(first)

    const second = await GET(
      new Request("http://localhost/api/quota", {
        headers: { cookie: `picta_sid=${id}` },
      }),
    )
    const secondBody = await second.json()

    const forwarded = await GET(
      new Request("http://localhost/api/quota", {
        headers: {
          cookie: `picta_sid=${id}`,
          "x-forwarded-for": "1.2.3.4",
        },
      }),
    )
    const forwardedBody = await forwarded.json()

    expect(firstBody).toEqual({
      sceneCreatesRemaining: 8,
      geminiCallsRemaining: 20,
      sceneWindowResetsAt: 0,
      geminiWindowResetsAt: 0,
      geminiConfigured: false,
    })
    expect(secondBody).toEqual(firstBody)
    expect(forwardedBody.sceneCreatesRemaining).toBe(firstBody.sceneCreatesRemaining)
    expect(windowCount()).toBe(before)

    const now = Date.now()
    const db = limitsForTests()
    const afterReads = remainingWindow(db, `sid:${id}:scene`, now, DAY_MS, 8)
    const again = remainingWindow(db, `sid:${id}:scene`, now, DAY_MS, 8)
    expect(afterReads.remaining).toBe(8)
    expect(again.remaining).toBe(afterReads.remaining)
  })

  it("reads an existing session window without incrementing it", async () => {
    delete process.env.TRUSTED_PROXY
    const created = await GET(new Request("http://localhost/api/quota"))
    const id = sessionIdFrom(created)
    const db = limitsForTests()
    const now = Date.now()
    for (let i = 0; i < 3; i += 1) {
      expect(takeWindow(db, `sid:${id}:scene`, now, DAY_MS, 8)).toEqual({ ok: true })
    }

    const request = new Request("http://localhost/api/quota", {
      headers: { cookie: `picta_sid=${id}` },
    })
    const first = await GET(request)
    const firstBody = await first.json()
    expect(firstBody.sceneCreatesRemaining).toBe(5)
    expect(firstBody.sceneWindowResetsAt).toBeGreaterThan(now)

    const second = await GET(
      new Request("http://localhost/api/quota", {
        headers: { cookie: `picta_sid=${id}` },
      }),
    )
    expect(await second.json()).toEqual(firstBody)
    expect(remainingWindow(db, `sid:${id}:scene`, now, DAY_MS, 8).remaining).toBe(5)
  })

  it("ignores X-Forwarded-For unless TRUSTED_PROXY is true", async () => {
    delete process.env.TRUSTED_PROXY
    const db = limitsForTests()
    const now = Date.now()
    for (let i = 0; i < 20; i += 1) {
      expect(takeWindow(db, "ip:1.2.3.4:scene", now, DAY_MS, 20)).toEqual({ ok: true })
    }
    expect(takeWindow(db, "ip:1.2.3.4:scene", now, DAY_MS, 20).ok).toBe(false)

    const request = new Request("http://localhost/api/quota", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    })
    expect(clientIp(request.headers, null)).toBe("unknown")

    const response = await GET(request)
    const body = await response.json()
    expect(body.sceneCreatesRemaining).toBe(8)
    expect(body.geminiCallsRemaining).toBe(20)
  })

  it("reports whether a server Gemini key is configured without returning it", async () => {
    process.env.GEMINI_API_KEY = "env-key"
    const response = await GET(new Request("http://localhost/api/quota"))
    const body = await response.json()
    expect(body.geminiConfigured).toBe(true)
    expect(JSON.stringify(body)).not.toContain("env-key")
  })
})
