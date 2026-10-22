import { describe, expect, it } from "vitest"
import {
  beginInflight,
  clearInflight,
  completeInflight,
  expireInflight,
  openLimits,
  readInflight,
  releaseScene,
  remainingWindow,
  takeWindow,
} from "./limits"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000
const SESSION_BUCKET = "sid:test:scene"
const IP = "203.0.113.9"
const IP_BUCKET = `ip:${IP}:scene`

function fillSession(cap = 8) {
  const db = openLimits(":memory:")
  for (let i = 0; i < cap; i += 1) {
    expect(takeWindow(db, SESSION_BUCKET, NOW, DAY_MS, cap)).toEqual({ ok: true })
  }
  return db
}

describe("limits", () => {
  it("accepts the 8th session scene take and refuses the 9th", () => {
    const db = fillSession()

    const refused = takeWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8)
    expect(refused).toEqual({ ok: false, resetsAt: NOW + DAY_MS })
    expect(refused.ok === false && refused.resetsAt > NOW).toBe(true)

    db.close()
  })

  it("allows another take only after the window is strictly exceeded", () => {
    const db = fillSession()

    expect(takeWindow(db, SESSION_BUCKET, NOW + DAY_MS, DAY_MS, 8)).toEqual({
      ok: false,
      resetsAt: NOW + DAY_MS,
    })
    expect(takeWindow(db, SESSION_BUCKET, NOW + DAY_MS + 1, DAY_MS, 8)).toEqual({ ok: true })

    db.close()
  })

  it("leaves the count unchanged when a take is refused", () => {
    const db = fillSession()

    const before = remainingWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8)
    expect(before.remaining).toBe(0)

    expect(takeWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8).ok).toBe(false)

    const after = remainingWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8)
    expect(after).toEqual(before)
    expect(after.remaining).toBe(0)

    const again = remainingWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8)
    expect(again).toEqual(after)

    releaseScene(db, "test", IP)
    expect(remainingWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8).remaining).toBe(1)

    db.close()
  })

  it("releases one scene from the session and ip buckets and floors at zero", () => {
    const db = fillSession()
    expect(takeWindow(db, IP_BUCKET, NOW, DAY_MS, 20)).toEqual({ ok: true })

    expect(remainingWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8).remaining).toBe(0)
    expect(remainingWindow(db, IP_BUCKET, NOW, DAY_MS, 20).remaining).toBe(19)

    releaseScene(db, "test", IP)

    expect(remainingWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8).remaining).toBe(1)
    expect(remainingWindow(db, IP_BUCKET, NOW, DAY_MS, 20).remaining).toBe(20)

    for (let i = 0; i < 7; i += 1) {
      releaseScene(db, "test", IP)
    }
    expect(remainingWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8).remaining).toBe(8)

    releaseScene(db, "test", IP)
    expect(remainingWindow(db, SESSION_BUCKET, NOW, DAY_MS, 8).remaining).toBe(8)
    expect(remainingWindow(db, IP_BUCKET, NOW, DAY_MS, 20).remaining).toBe(20)

    releaseScene(db, "absent", "absent")
    expect(remainingWindow(db, "sid:absent:scene", NOW, DAY_MS, 8).remaining).toBe(8)
    expect(remainingWindow(db, "ip:absent:scene", NOW, DAY_MS, 20).remaining).toBe(20)

    db.close()
  })
})

const FIVE_MINUTES_MS = 5 * 60 * 1000
const SID = "sid-illustrate"
const KEY = "4b6d8e2a-1c0f-4a7b-9d3e-5f6a7b8c9d0e"

describe("inflight", () => {
  it("begin then read shows a null projectId", () => {
    const db = openLimits(":memory:")

    expect(readInflight(db, SID)).toBeNull()
    expect(beginInflight(db, SID, KEY, NOW)).toEqual({ ok: true })

    expect(readInflight(db, SID)).toEqual({
      sid: SID,
      idempotencyKey: KEY,
      projectId: null,
      moment: null,
      imagePrompt: null,
      creditsCharged: null,
      startedAt: NOW,
    })

    db.close()
  })

  it("second begin with the same key returns in_progress", () => {
    const db = openLimits(":memory:")
    expect(beginInflight(db, SID, KEY, NOW)).toEqual({ ok: true })
    const before = readInflight(db, SID)

    expect(beginInflight(db, SID, KEY, NOW + 1)).toEqual({ ok: false, reason: "in_progress" })
    expect(readInflight(db, SID)).toEqual(before)

    db.close()
  })

  it("replays the same key after complete without changing the project id", () => {
    const db = openLimits(":memory:")
    expect(beginInflight(db, SID, KEY, NOW)).toEqual({ ok: true })
    completeInflight(db, SID, {
      projectId: "proj-lantern",
      moment: "The landing",
      imagePrompt: "A lantern in a stairwell.",
      creditsCharged: 5,
    })
    const before = readInflight(db, SID)

    expect(beginInflight(db, SID, KEY, NOW + 40)).toEqual({ ok: true })
    expect(readInflight(db, SID)).toEqual(before)
    expect(readInflight(db, SID)?.projectId).toBe("proj-lantern")

    db.close()
  })

  it("a different key returns busy", () => {
    const db = openLimits(":memory:")
    expect(beginInflight(db, SID, KEY, NOW)).toEqual({ ok: true })
    const before = readInflight(db, SID)

    expect(beginInflight(db, SID, "other-key", NOW + 5)).toEqual({ ok: false, reason: "busy" })
    expect(readInflight(db, SID)).toEqual(before)

    db.close()
  })

  it("expires a row older than 5 minutes and keeps one at exactly 5 minutes", () => {
    const db = openLimits(":memory:")
    expect(beginInflight(db, "stale", "key-stale", NOW - FIVE_MINUTES_MS - 1)).toEqual({ ok: true })
    expect(beginInflight(db, "exact", "key-exact", NOW - FIVE_MINUTES_MS)).toEqual({ ok: true })

    expireInflight(db, NOW)

    expect(readInflight(db, "stale")).toBeNull()
    expect(readInflight(db, "exact")?.startedAt).toBe(NOW - FIVE_MINUTES_MS)

    db.close()
  })

  it("clearInflight then read returns null", () => {
    const db = openLimits(":memory:")
    expect(beginInflight(db, SID, KEY, NOW)).toEqual({ ok: true })

    clearInflight(db, SID)

    expect(readInflight(db, SID)).toBeNull()

    db.close()
  })

  it("stores the image prompt and has no page_text column", () => {
    const db = openLimits(":memory:")
    expect(beginInflight(db, SID, KEY, NOW)).toEqual({ ok: true })
    completeInflight(db, SID, {
      projectId: "proj-lantern",
      moment: "The landing",
      imagePrompt: "A lantern in a stairwell.",
      creditsCharged: 5,
    })

    const cell = db.prepare<[string], { image_prompt: string }>(
      "select image_prompt from inflight where sid = ?",
    ).get(SID)
    expect(cell?.image_prompt).toBe("A lantern in a stairwell.")
    expect(readInflight(db, SID)).not.toBeNull()

    const columns = db
      .prepare<[], { name: string }>("select name from pragma_table_info('inflight')")
      .all()
    expect(columns.map((column) => column.name)).toEqual([
      "sid",
      "idempotency_key",
      "project_id",
      "moment",
      "image_prompt",
      "credits_charged",
      "started_at",
    ])
    expect(columns.map((column) => column.name)).not.toContain("page_text")

    db.close()
  })

  it("completeInflight does nothing when the sid is missing", () => {
    const db = openLimits(":memory:")

    completeInflight(db, "missing", {
      projectId: "proj-lantern",
      moment: "The landing",
      imagePrompt: "A lantern in a stairwell.",
      creditsCharged: 5,
    })

    expect(readInflight(db, "missing")).toBeNull()

    db.close()
  })
})
