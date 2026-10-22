import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { GeminiClient } from "../../../../lib/gemini"
import { readInflight, remainingWindow } from "../../../../lib/limits"
import {
  createMockMagicHourClient,
  mockFailNext,
  type MagicHourClient,
} from "../../../../lib/magic-hour"
import { POST } from "../route"
import { limitsForTests } from "../shared"
import { DELETE, GET, runtime } from "./route"

const DAY_MS = 24 * 60 * 60 * 1000
const SCENE_CAP = 8

function newSid(): string {
  return randomBytes(32).toString("hex")
}

function illustratingClient(): GeminiClient {
  return {
    async transcribe() {
      return null
    },
    async illustrate() {
      return {
        allowed: true,
        rejectReason: null,
        moment: "A quiet corner of the page",
        imagePrompt: "A lantern in a stairwell.",
      }
    },
  }
}

function postJson(pageText: string, sid: string): Request {
  return new Request("http://localhost/api/scenes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      cookie: `picta_sid=${sid}`,
    },
    body: JSON.stringify({ pageText }),
  })
}

function projectRequest(method: string, projectId: string, sid: string): Request {
  return new Request(`http://localhost/api/scenes/${projectId}`, {
    method,
    headers: { cookie: `picta_sid=${sid}` },
  })
}

function params(projectId: string): { params: Promise<{ projectId: string }> } {
  return { params: Promise.resolve({ projectId }) }
}

async function createScene(sid: string, magicHour: MagicHourClient): Promise<string> {
  const response = await POST(postJson("A page of text.", sid), {
    gemini: illustratingClient(),
    magicHour,
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { allowed: boolean; projectId: string; simulated?: boolean }
  expect(body.allowed).toBe(true)
  expect(body.simulated).toBe(true)
  return body.projectId
}

describe("GET and DELETE /api/scenes/:projectId", () => {
  it("runs on the nodejs runtime", () => {
    expect(runtime).toBe("nodejs")
  })

  it("returns rendering and then the PNG", async () => {
    const sid = newSid()
    const db = limitsForTests()
    const magicHour = createMockMagicHourClient()
    const projectId = await createScene(sid, magicHour)

    const missing = await GET(projectRequest("GET", projectId, sid), params(crypto.randomUUID()), { magicHour })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: "not_found" })

    const first = await GET(projectRequest("GET", projectId, sid), params(projectId), { magicHour })
    expect(first.status).toBe(200)
    expect(first.headers.get("content-type")).toContain("application/json")
    expect(await first.json()).toEqual({ status: "rendering" })

    const second = await GET(projectRequest("GET", projectId, sid), params(projectId), { magicHour })
    expect(second.status).toBe(200)
    expect(second.headers.get("content-type")).toContain("image/png")
    expect(second.headers.get("x-picta-status")).toBe("complete")
    expect(Array.from(new Uint8Array(await second.arrayBuffer()).slice(0, 4))).toEqual([137, 80, 78, 71])
    expect(readInflight(db, sid)?.projectId).toBe(projectId)
  })

  it("refunds a render error and releases the scene window", async () => {
    const sid = newSid()
    const db = limitsForTests()
    const magicHour = createMockMagicHourClient()
    const projectId = await createScene(sid, magicHour)
    const bucket = `sid:${sid}:scene`
    const before = remainingWindow(db, bucket, Date.now(), DAY_MS, SCENE_CAP).remaining

    mockFailNext(magicHour, "error")
    const response = await GET(projectRequest("GET", projectId, sid), params(projectId), { magicHour })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "refunded" })
    expect(remainingWindow(db, bucket, Date.now(), DAY_MS, SCENE_CAP).remaining).toBe(before + 1)
    expect(readInflight(db, sid)).toBeNull()
  })

  it("returns 502 when the download throws and keeps the row", async () => {
    const sid = newSid()
    const db = limitsForTests()
    const magicHour = createMockMagicHourClient()
    const projectId = await createScene(sid, magicHour)
    const bucket = `sid:${sid}:scene`
    const before = remainingWindow(db, bucket, Date.now(), DAY_MS, SCENE_CAP).remaining

    mockFailNext(magicHour, "download")
    const response = await GET(projectRequest("GET", projectId, sid), params(projectId), { magicHour })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "download_failed" })
    expect(remainingWindow(db, bucket, Date.now(), DAY_MS, SCENE_CAP).remaining).toBe(before)
    expect(readInflight(db, sid)?.projectId).toBe(projectId)
  })

  it("deletes a matching row and still returns ok when it is already gone", async () => {
    const sid = newSid()
    const db = limitsForTests()
    const magicHour = createMockMagicHourClient()
    const projectId = await createScene(sid, magicHour)
    const otherId = crypto.randomUUID()

    const wrong = await DELETE(projectRequest("DELETE", otherId, sid), params(otherId))
    expect(wrong.status).toBe(200)
    expect(await wrong.json()).toEqual({ ok: true })
    expect(readInflight(db, sid)?.projectId).toBe(projectId)

    const removed = await DELETE(projectRequest("DELETE", projectId, sid), params(projectId))
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ ok: true })
    expect(readInflight(db, sid)).toBeNull()

    const missing = await DELETE(projectRequest("DELETE", projectId, sid), params(projectId))
    expect(missing.status).toBe(200)
    expect(await missing.json()).toEqual({ ok: true })
  })
})
