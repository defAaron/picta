import { describe, expect, it } from "vitest"
import { openLimits, releaseScene, remainingWindow, takeWindow } from "./limits"

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
