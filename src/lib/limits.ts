import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"

export type LimitsDb = Database.Database

const DEFAULT_FILENAME = path.join("data", "limits.sqlite")

type WindowRow = {
  count: number
  window_start: number
}

type TakeResult = { ok: true } | { ok: false; resetsAt: number }

type RemainingResult = { remaining: number; resetsAt: number }

const CREATE_WINDOWS = `
  create table if not exists windows (
    bucket text primary key,
    count integer not null,
    window_start integer not null
  )
`

export function openLimits(filename?: string): LimitsDb {
  const file = filename ?? DEFAULT_FILENAME
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  const db = new Database(file)
  db.exec(CREATE_WINDOWS)
  return db
}

function selectWindow(db: LimitsDb, bucket: string): WindowRow | undefined {
  return db
    .prepare<[string], WindowRow>("select count, window_start from windows where bucket = ?")
    .get(bucket)
}

function saveWindow(db: LimitsDb, bucket: string, count: number, windowStart: number): void {
  db.prepare<[string, number, number]>(
    `insert into windows (bucket, count, window_start)
     values (?, ?, ?)
     on conflict(bucket) do update set
       count = excluded.count,
       window_start = excluded.window_start`,
  ).run(bucket, count, windowStart)
}

function expired(row: WindowRow, nowMs: number, windowMs: number): boolean {
  return nowMs - row.window_start > windowMs
}

export function takeWindow(
  db: LimitsDb,
  bucket: string,
  nowMs: number,
  windowMs: number,
  cap: number,
): TakeResult {
  const run = db.transaction((): TakeResult => {
    const row = selectWindow(db, bucket)
    const open = row !== undefined && !expired(row, nowMs, windowMs)
    const count = open ? row.count : 0
    const windowStart = open ? row.window_start : nowMs
    const resetsAt = windowStart + windowMs

    if (count >= cap) {
      if (!open && row !== undefined) {
        saveWindow(db, bucket, 0, windowStart)
      }
      return { ok: false, resetsAt }
    }

    saveWindow(db, bucket, count + 1, windowStart)
    return { ok: true }
  })

  return run()
}

export function remainingWindow(
  db: LimitsDb,
  bucket: string,
  nowMs: number,
  windowMs: number,
  cap: number,
): RemainingResult {
  const run = db.transaction((): RemainingResult => {
    const row = selectWindow(db, bucket)
    if (row === undefined || expired(row, nowMs, windowMs)) {
      if (row !== undefined) {
        saveWindow(db, bucket, 0, nowMs)
      }
      return { remaining: Math.max(0, cap), resetsAt: nowMs + windowMs }
    }

    return {
      remaining: Math.max(0, cap - row.count),
      resetsAt: row.window_start + windowMs,
    }
  })

  return run()
}

export function releaseScene(db: LimitsDb, sessionId: string, ip: string): void {
  const decrement = db.prepare<[string]>(
    "update windows set count = count - 1 where bucket = ? and count > 0",
  )
  const run = db.transaction(() => {
    decrement.run(`sid:${sessionId}:scene`)
    decrement.run(`ip:${ip}:scene`)
  })
  run()
}
