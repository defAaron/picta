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

function upload(type: string, sessionId?: string, bytes: Uint8Array = new Uint8Array([1, 2, 3])): Request {
  const form = new FormData()
  form.append("image", new File([bytes], "page.bin", { type }))
  const headers = new Headers()
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
    expect(tables).toEqual([{ name: "windows" }])

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

  it("returns 502 without calling fetch when the api key is unset and no client is passed", async () => {
    delete process.env.GEMINI_API_KEY
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 500 }))
    try {
      const response = await POST(upload("image/png"))
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: "transcribe_unavailable" })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      if (originalKey === undefined) delete process.env.GEMINI_API_KEY
      else process.env.GEMINI_API_KEY = originalKey
    }
  })
})
