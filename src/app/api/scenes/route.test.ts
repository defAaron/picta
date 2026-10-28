import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { clientIp } from "../../../lib/client-ip"
import { MAX_DIRECT_PROMPT } from "../../../lib/direct-scene"
import type { GeminiClient } from "../../../lib/gemini"
import { beginInflight, readInflight, takeWindow, type LimitsDb } from "../../../lib/limits"
import { createMockMagicHourClient, mockPrompts } from "../../../lib/magic-hour"
import { POST, runtime } from "./route"
import { limitsForTests } from "./shared"

const DAY_MS = 24 * 60 * 60 * 1000
const SCENE_CAP = 8
const originalKey = process.env.GEMINI_API_KEY

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalKey
})

function newSid(): string {
  return randomBytes(32).toString("hex")
}

function postJson(
  pageText: string,
  sid?: string,
  key = crypto.randomUUID(),
  extra?: HeadersInit,
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "Idempotency-Key": key,
  })
  if (extra !== undefined) {
    new Headers(extra).forEach((value, name) => {
      headers.set(name, value)
    })
  }
  if (sid !== undefined) headers.set("cookie", `picta_sid=${sid}`)
  return new Request("http://localhost/api/scenes", {
    method: "POST",
    headers,
    body: JSON.stringify({ pageText }),
  })
}

function allowedScene(imagePrompt = "A lantern in a stairwell.", moment = "A quiet corner of the page") {
  return {
    allowed: true,
    rejectReason: null as string | null,
    moment,
    imagePrompt,
  }
}

function illustratingClient(onIllustrate: (pageText: string) => unknown): { client: GeminiClient; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    client: {
      async transcribe() {
        return null
      },
      async illustrate(pageText) {
        calls.push(pageText)
        return onIllustrate(pageText)
      },
    },
  }
}

function windowCount(db: LimitsDb, bucket: string): number {
  const row = db.prepare("select count from windows where bucket = ?").get(bucket) as { count: number } | undefined
  return row?.count ?? 0
}

function sceneRows(db: LimitsDb): Array<{ bucket: string; count: number }> {
  return db
    .prepare("select bucket, count from windows where bucket like '%:scene' order by bucket")
    .all() as Array<{ bucket: string; count: number }>
}

describe("POST /api/scenes", () => {
  it("runs on the nodejs runtime and does not log", () => {
    expect(runtime).toBe("nodejs")
    for (const relative of [
      "src/app/api/scenes/route.ts",
      "src/app/api/scenes/shared.ts",
      "src/app/api/scenes/[projectId]/route.ts",
    ]) {
      const source = readFileSync(path.join(process.cwd(), relative), "utf8")
      expect(source).not.toMatch(/\bconsole\s*\./)
    }
  })

  it("returns 400 for 5001 characters and does not call a provider", async () => {
    const sid = newSid()
    const db = limitsForTests()
    const gemini = illustratingClient(() => allowedScene())
    const magicHour = createMockMagicHourClient()

    const response = await POST(postJson("a".repeat(5001), sid), { gemini: gemini.client, magicHour })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "bad_page" })
    expect(gemini.calls).toEqual([])
    expect(mockPrompts(magicHour)).toEqual([])
    expect(windowCount(db, `sid:${sid}:gemini`)).toBe(0)
    expect(windowCount(db, `sid:${sid}:scene`)).toBe(0)
  })

  it("returns 400 for a non-JSON body and does not call a provider", async () => {
    const gemini = illustratingClient(() => allowedScene())
    const magicHour = createMockMagicHourClient()
    const headers = new Headers({
      "content-type": "text/plain",
      "Idempotency-Key": crypto.randomUUID(),
    })
    const response = await POST(
      new Request("http://localhost/api/scenes", { method: "POST", headers, body: "not json" }),
      { gemini: gemini.client, magicHour },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "bad_page" })
    expect(gemini.calls).toEqual([])
    expect(mockPrompts(magicHour)).toEqual([])
    expect(response.headers.getSetCookie().some((value) => value.startsWith("picta_sid="))).toBe(true)
  })

  it("returns allowed false and does not take a scene window", async () => {
    const sid = newSid()
    const db = limitsForTests()
    const before = sceneRows(db)
    const gemini = illustratingClient(() => ({
      allowed: false,
      rejectReason: "Not a scene",
      moment: "A quiet corner of the page",
      imagePrompt: "A lantern in a stairwell.",
    }))
    const magicHour = createMockMagicHourClient()

    const response = await POST(postJson("A contents page.", sid), { gemini: gemini.client, magicHour })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ allowed: false, reason: "Not a scene" })
    expect(mockPrompts(magicHour)).toEqual([])
    expect(sceneRows(db)).toEqual(before)
  })

  it("returns 429 busy for a second key while the first row exists", async () => {
    const sid = newSid()
    const gemini = illustratingClient(() => allowedScene())
    const magicHour = createMockMagicHourClient()
    const deps = { gemini: gemini.client, magicHour }

    const first = await POST(postJson("First page.", sid), deps)
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.allowed).toBe(true)
    expect(firstBody.simulated).toBe(true)

    const second = await POST(postJson("Second page.", sid), deps)
    expect(second.status).toBe(429)
    expect(await second.json()).toEqual({ error: "busy" })
    expect(mockPrompts(magicHour)).toHaveLength(1)
    expect(gemini.calls).toHaveLength(1)
  })

  it("replays the original project for the same key without creating again", async () => {
    const sid = newSid()
    const key = crypto.randomUUID()
    const gemini = illustratingClient(() => allowedScene())
    const magicHour = createMockMagicHourClient()
    const deps = { gemini: gemini.client, magicHour }

    const first = await POST(postJson("Same page.", sid, key), deps)
    const firstBody = await first.json()
    const second = await POST(postJson("Same page.", sid, key), deps)

    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(firstBody)
    expect(firstBody.projectId).toEqual(expect.any(String))
    expect(firstBody.simulated).toBe(true)
    expect(mockPrompts(magicHour)).toHaveLength(1)
    expect(gemini.calls).toHaveLength(1)
  })

  it("returns 409 when the same key is already in progress", async () => {
    const sid = newSid()
    const key = crypto.randomUUID()
    beginInflight(limitsForTests(), sid, key, Date.now())
    const gemini = illustratingClient(() => allowedScene())
    const magicHour = createMockMagicHourClient()

    const response = await POST(postJson("A page.", sid, key), { gemini: gemini.client, magicHour })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "in_progress" })
    expect(gemini.calls).toEqual([])
    expect(mockPrompts(magicHour)).toEqual([])
  })

  it("stores the scene prompt and never the page text", async () => {
    const sid = newSid()
    const db = limitsForTests()
    const gemini = illustratingClient(() => allowedScene("A lantern in a stairwell.", "The stairwell landing"))
    const magicHour = createMockMagicHourClient()

    const response = await POST(postJson("SECRET_PAGE_TEXT", sid), { gemini: gemini.client, magicHour })

    expect(response.status).toBe(200)
    expect((await response.json()).simulated).toBe(true)
    expect(gemini.calls).toEqual(["SECRET_PAGE_TEXT"])
    const windows = db.prepare("select * from windows").all() as Array<Record<string, unknown>>
    const inflight = db.prepare("select * from inflight").all() as Array<Record<string, unknown>>
    for (const row of [...windows, ...inflight]) {
      for (const value of Object.values(row)) {
        expect(value).not.toBe("SECRET_PAGE_TEXT")
      }
    }
    expect(inflight.find((row) => row.sid === sid)?.image_prompt).toBe("A lantern in a stairwell.")
  })

  it("sends the description to Magic Hour when the Gemini key is unset", async () => {
    delete process.env.GEMINI_API_KEY
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"))
    try {
      const sid = newSid()
      const db = limitsForTests()
      const magicHour = createMockMagicHourClient()

      const response = await POST(postJson("Mice\n\nin   the margin.", sid), { magicHour })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({
        allowed: true,
        moment: "Mice in the margin.",
        imagePrompt: "Mice in the margin.",
        creditsCharged: 5,
        simulated: true,
      })
      expect(body.projectId).toEqual(expect.any(String))
      expect(mockPrompts(magicHour)).toEqual(["Mice in the margin."])
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(windowCount(db, `sid:${sid}:gemini`)).toBe(0)
      expect(windowCount(db, `sid:${sid}:scene`)).toBe(1)
      const inflight = db.prepare("select image_prompt from inflight where sid = ?").get(sid) as {
        image_prompt: string
      }
      expect(inflight.image_prompt).toBe("Mice in the margin.")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("sends a 1,500 character description to Magic Hour when the Gemini key is unset", async () => {
    delete process.env.GEMINI_API_KEY
    const sid = newSid()
    const magicHour = createMockMagicHourClient()
    const pageText = "a".repeat(MAX_DIRECT_PROMPT)

    const response = await POST(postJson(pageText, sid), { magicHour })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      allowed: true,
      moment: "a".repeat(200),
      imagePrompt: pageText,
    })
    expect(mockPrompts(magicHour)).toEqual([pageText])
  })

  it("refuses a direct description longer than 1,500 characters and does not call Magic Hour", async () => {
    delete process.env.GEMINI_API_KEY
    const sid = newSid()
    const db = limitsForTests()
    const magicHour = createMockMagicHourClient()
    const pageText = "a".repeat(MAX_DIRECT_PROMPT + 1)

    const response = await POST(postJson(pageText, sid), { magicHour })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      allowed: false,
      reason: "Without a Gemini key, keep the description to 1,500 characters.",
    })
    expect(mockPrompts(magicHour)).toEqual([])
    expect(readInflight(db, sid)).toBeNull()
    expect(windowCount(db, `sid:${sid}:scene`)).toBe(0)
    expect(JSON.stringify(db.prepare("select * from inflight").all())).not.toContain(pageText)
  })

  it("rejects an oversized Gemini key instead of sending the page to Magic Hour", async () => {
    process.env.GEMINI_API_KEY = "env-key"
    const magicHour = createMockMagicHourClient()

    const response = await POST(
      postJson("Mice in the margin.", newSid(), crypto.randomUUID(), {
        "x-picta-gemini-key": "g".repeat(257),
        "x-picta-magic-hour-key": "test-key",
      }),
      { magicHour },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "missing_api_key" })
    expect(mockPrompts(magicHour)).toEqual([])
  })

  it("returns 402 when live Magic Hour has no credits and rolls the scene window back", async () => {
    const previousKey = process.env.MAGIC_HOUR_API_KEY
    process.env.MAGIC_HOUR_API_KEY = "other-key"
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (!url.endsWith("/v1/ai-image-generator")) throw new Error("unexpected fetch")
      const authorization = new Headers(init?.headers).get("authorization")
      if (authorization !== "Bearer test-key") throw new Error("unexpected authorization")
      return new Response(null, { status: 402 })
    })
    try {
      const sid = newSid()
      const db = limitsForTests()
      const ip = clientIp(new Headers(), null)
      const ipBefore = windowCount(db, `ip:${ip}:scene`)
      const gemini = illustratingClient(() => allowedScene("A lantern in a stairwell."))

      const response = await POST(
        postJson("A page.", sid, crypto.randomUUID(), { "x-picta-magic-hour-key": "test-key" }),
        { gemini: gemini.client },
      )

      expect(response.status).toBe(402)
      expect(await response.json()).toEqual({ error: "insufficient_credits" })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(windowCount(db, `sid:${sid}:scene`)).toBe(0)
      expect(windowCount(db, `ip:${ip}:scene`)).toBe(ipBefore)
      expect(readInflight(db, sid)).toBeNull()
    } finally {
      fetchSpy.mockRestore()
      if (previousKey === undefined) delete process.env.MAGIC_HOUR_API_KEY
      else process.env.MAGIC_HOUR_API_KEY = previousKey
    }
  })

  it("returns 401 when Gemini rejects the key with status 400 and does not call Magic Hour", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (!url.includes("generativelanguage.googleapis.com")) throw new Error("unexpected fetch")
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: "secret-body",
            status: "INVALID_ARGUMENT",
            details: [{ reason: "API_KEY_INVALID" }],
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      )
    })
    try {
      const sid = newSid()
      const db = limitsForTests()
      const response = await POST(
        postJson("A page.", sid, crypto.randomUUID(), {
          "x-picta-gemini-key": "test-key",
          "x-picta-magic-hour-key": "test-key",
        }),
      )

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "rejected_api_key" })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(windowCount(db, `sid:${sid}:scene`)).toBe(0)
      expect(readInflight(db, sid)).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("returns gemini_busy when Gemini is unavailable and does not call Magic Hour", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (!url.includes("generativelanguage.googleapis.com")) throw new Error("unexpected fetch")
      return new Response(null, { status: 503 })
    })
    try {
      const sid = newSid()
      const response = await POST(
        postJson("A page.", sid, crypto.randomUUID(), {
          "x-picta-gemini-key": "test-key",
          "x-picta-magic-hour-key": "test-key",
        }),
      )

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: "gemini_busy" })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("returns gemini_402 when the Gemini account is out of credits", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (!url.includes("generativelanguage.googleapis.com")) throw new Error("unexpected fetch")
      return new Response(null, { status: 402 })
    })
    try {
      const sid = newSid()
      const response = await POST(
        postJson("A page.", sid, crypto.randomUUID(), {
          "x-picta-gemini-key": "test-key",
          "x-picta-magic-hour-key": "test-key",
        }),
      )

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: "gemini_402" })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("returns 502 when illustrate throws and does not call Magic Hour", async () => {
    const sid = newSid()
    const db = limitsForTests()
    const gemini = illustratingClient(() => {
      throw new Error("down")
    })
    const magicHour = createMockMagicHourClient()

    const response = await POST(postJson("A page.", sid), { gemini: gemini.client, magicHour })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "illustrate_unavailable" })
    expect(mockPrompts(magicHour)).toEqual([])
    expect(readInflight(db, sid)).toBeNull()
    expect(windowCount(db, `sid:${sid}:gemini`)).toBe(1)
    expect(windowCount(db, `sid:${sid}:scene`)).toBe(0)
  })

  it("ignores MAGIC_HOUR_API_KEY when the request has no typed key", async () => {
    const previousKey = process.env.MAGIC_HOUR_API_KEY
    process.env.MAGIC_HOUR_API_KEY = "test-key"
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"))
    try {
      const sid = newSid()
      const db = limitsForTests()
      const gemini = illustratingClient(() => allowedScene())

      const response = await POST(postJson("A page.", sid), { gemini: gemini.client })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "missing_api_key" })
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(gemini.calls).toEqual([])
      expect(readInflight(db, sid)).toBeNull()
    } finally {
      fetchSpy.mockRestore()
      if (previousKey === undefined) delete process.env.MAGIC_HOUR_API_KEY
      else process.env.MAGIC_HOUR_API_KEY = previousKey
    }
  })

  it("returns 429 when the scene window is full and does not call a provider", async () => {
    const sid = newSid()
    const db = limitsForTests()
    const now = Date.now()
    for (let i = 0; i < SCENE_CAP; i += 1) {
      expect(takeWindow(db, `sid:${sid}:scene`, now, DAY_MS, SCENE_CAP)).toEqual({ ok: true })
    }
    const gemini = illustratingClient(() => allowedScene())
    const magicHour = createMockMagicHourClient()

    const response = await POST(postJson("A page.", sid), { gemini: gemini.client, magicHour })

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: "rate_limited", resetsAt: now + DAY_MS })
    expect(gemini.calls).toEqual([])
    expect(mockPrompts(magicHour)).toEqual([])
  })
})
