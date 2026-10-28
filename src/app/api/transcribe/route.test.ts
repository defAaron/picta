import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { GeminiClient } from "../../../lib/gemini"
import { remainingWindow, takeWindow } from "../../../lib/limits"
import { POST, limitsForTests, runtime } from "./route"

const HOUR_MS = 60 * 60 * 1000
const SESSION_CAP = 20
const originalKey = process.env.GEMINI_API_KEY

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.GEMINI_API_KEY
  } else {
    process.env.GEMINI_API_KEY = originalKey
  }
})

type RecordedCall = {
  byteLength: number
  mimeType: string
}

function fakeClient(result: unknown): { client: GeminiClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    client: {
      async transcribe(image, mimeType) {
        calls.push({ byteLength: image.byteLength, mimeType })
        return result
      },
    },
  }
}

function upload(
  type: string,
  sessionId?: string,
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
  extra?: HeadersInit,
): Request {
  const form = new FormData()
  form.append("image", new File([bytes], "page.bin", { type }))
  const headers = new Headers(extra)
  if (sessionId !== undefined) headers.set("cookie", `picta_sid=${sessionId}`)
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    body: form,
    headers,
  })
}

function sessionBucket(id: string): string {
  return `sid:${id}:gemini`
}

describe("POST /api/transcribe", () => {
  it("runs on the nodejs runtime", () => {
    expect(runtime).toBe("nodejs")
  })

  it("does not log from the route file", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/transcribe/route.ts"), "utf8")
    expect(source).not.toMatch(/\bconsole\s*\./)
  })

  it("rejects a text/plain upload without calling Gemini or spending a window", async () => {
    const id = randomBytes(32).toString("hex")
    const fake = fakeClient({ accepted: true, rejectReason: null, singlePage: true, text: "nope" })
    const db = limitsForTests()

    const response = await POST(upload("text/plain", id), fake.client)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "bad_image" })
    expect(fake.calls).toEqual([])

    const bucket = sessionBucket(id)
    const row = db.prepare("select count from windows where bucket = ?").get(bucket) as
      | { count: number }
      | undefined
    expect(row?.count ?? 0).toBe(0)
    expect(remainingWindow(db, bucket, Date.now(), HOUR_MS, SESSION_CAP).remaining).toBe(SESSION_CAP)
  })

  it("returns 429 when the session Gemini window is full and does not call Gemini", async () => {
    const id = randomBytes(32).toString("hex")
    const db = limitsForTests()
    const now = Date.now()
    for (let i = 0; i < SESSION_CAP; i += 1) {
      expect(takeWindow(db, sessionBucket(id), now, HOUR_MS, SESSION_CAP)).toEqual({ ok: true })
    }
    const fake = fakeClient({ accepted: true, rejectReason: null, singlePage: true, text: "Hello" })

    const response = await POST(upload("image/png", id), fake.client)
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({
      error: "rate_limited",
      resetsAt: now + HOUR_MS,
    })
    expect(fake.calls).toEqual([])
  })

  it("returns the reject reason when the page is declined", async () => {
    const fake = fakeClient({
      accepted: false,
      rejectReason: "Not a page",
      singlePage: true,
      text: "ignored",
    })

    const response = await POST(upload("image/png"), fake.client)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accepted: false, reason: "Not a page" })
  })

  it("returns the fixed reason when the photo is not a single page", async () => {
    const fake = fakeClient({
      accepted: true,
      rejectReason: "Not a page",
      singlePage: false,
      text: "Hello",
    })

    const response = await POST(upload("image/jpeg"), fake.client)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      accepted: false,
      reason: "Photograph one page at a time.",
    })
  })

  it("returns an empty reason when a declined page has no reject reason", async () => {
    const fake = fakeClient({
      accepted: false,
      rejectReason: null,
      singlePage: true,
      text: "ignored",
    })

    const response = await POST(upload("image/png"), fake.client)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accepted: false, reason: "" })
  })

  it("rejects an empty transcription", async () => {
    const fake = fakeClient({
      accepted: true,
      rejectReason: null,
      singlePage: true,
      text: "   ",
    })

    const response = await POST(upload("image/jpeg"), fake.client)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      accepted: false,
      reason: "The transcription was empty.",
    })
  })

  it("trims a long reject reason to 200 characters", async () => {
    const reason = "R".repeat(250)
    const fake = fakeClient({
      accepted: false,
      rejectReason: reason,
      singlePage: true,
      text: "ignored",
    })

    const response = await POST(upload("image/webp"), fake.client)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      accepted: false,
      reason: "R".repeat(200),
    })
  })

  it("returns trimmed text and writes only window buckets", async () => {
    const fake = fakeClient({
      accepted: true,
      rejectReason: null,
      singlePage: true,
      text: "  Hello  ",
    })

    const response = await POST(upload("image/png", undefined, new Uint8Array([9, 8, 7, 6])), fake.client)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accepted: true, text: "Hello" })
    expect(fake.calls).toEqual([{ byteLength: 4, mimeType: "image/png" }])

    const db = limitsForTests()
    const tables = db
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
      .all() as Array<{ name: string }>
    expect(tables.map((table) => table.name).sort()).toEqual(["inflight", "windows"])
    expect(db.prepare("select * from inflight").all()).toEqual([])

    const rows = db.prepare("select * from windows").all() as Array<Record<string, unknown>>
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.bucket).toEqual(expect.stringMatching(/^(sid|ip):[^:]+:gemini$/))
      for (const value of Object.values(row)) {
        expect(value).not.toBe("Hello")
        expect(value).not.toBe("  Hello  ")
      }
    }
  })

  it("returns 400 without calling fetch when no Gemini key is available", async () => {
    delete process.env.GEMINI_API_KEY
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 500 }))
    try {
      const id = randomBytes(32).toString("hex")
      const response = await POST(upload("image/png", id))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "missing_api_key" })
      expect(fetchSpy).not.toHaveBeenCalled()
      const bucket = sessionBucket(id)
      expect(remainingWindow(limitsForTests(), bucket, Date.now(), HOUR_MS, SESSION_CAP).remaining).toBe(
        SESSION_CAP,
      )
    } finally {
      fetchSpy.mockRestore()
      if (originalKey === undefined) delete process.env.GEMINI_API_KEY
      else process.env.GEMINI_API_KEY = originalKey
    }
  })

  it("sends the typed Gemini key and does not fall through from an oversized key", async () => {
    process.env.GEMINI_API_KEY = "env-key"
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }))
    try {
      const typed = await POST(upload("image/png", undefined, new Uint8Array([1]), {
        "x-picta-gemini-key": "typed-key",
      }))
      const typedBody = await typed.json()
      expect(typed.status).toBe(401)
      expect(typedBody).toEqual({ error: "rejected_api_key" })
      expect(JSON.stringify(typedBody)).not.toContain("typed-key")
      const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers)
      expect(headers.get("x-goog-api-key")).toBe("typed-key")

      fetchSpy.mockClear()
      const oversized = await POST(upload("image/png", undefined, new Uint8Array([1]), {
        "x-picta-gemini-key": "g".repeat(257),
      }))
      expect(oversized.status).toBe(400)
      expect(await oversized.json()).toEqual({ error: "missing_api_key" })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
