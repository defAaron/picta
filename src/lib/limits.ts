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

const CREATE_INFLIGHT = `
  create table if not exists inflight (
    sid text primary key,
    idempotency_key text not null,
    project_id text,
    moment text,
    image_prompt text,
    credits_charged integer,
    started_at integer not null
  )
`

const INFLIGHT_MAX_AGE_MS = 5 * 60 * 1000

export type InflightRow = {
  sid: string
  idempotencyKey: string
  projectId: string | null
  moment: string | null
  imagePrompt: string | null
  creditsCharged: number | null
  startedAt: number
}

type InflightSqlRow = {
  sid: string
  idempotency_key: string
  project_id: string | null
  moment: string | null
  image_prompt: string | null
  credits_charged: number | null
  started_at: number
}

type BeginInflightResult = { ok: true } | { ok: false; reason: "in_progress" | "busy" }

export function openLimits(filename?: string): LimitsDb {
  const file = filename ?? DEFAULT_FILENAME
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  const db = new Database(file)
  db.exec(CREATE_WINDOWS)
  db.exec(CREATE_INFLIGHT)
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

function selectInflight(db: LimitsDb, sid: string): InflightSqlRow | undefined {
  return db
    .prepare<[string], InflightSqlRow>(
      `select sid, idempotency_key, project_id, moment, image_prompt, credits_charged, started_at
       from inflight
       where sid = ?`,
    )
    .get(sid)
}

function toInflightRow(row: InflightSqlRow): InflightRow {
  return {
    sid: row.sid,
    idempotencyKey: row.idempotency_key,
    projectId: row.project_id,
    moment: row.moment,
    imagePrompt: row.image_prompt,
    creditsCharged: row.credits_charged,
    startedAt: row.started_at,
  }
}

export function beginInflight(
  db: LimitsDb,
  sid: string,
  idempotencyKey: string,
  nowMs: number,
): BeginInflightResult {
  const run = db.transaction((): BeginInflightResult => {
    const row = selectInflight(db, sid)
    if (row === undefined) {
      db.prepare<[string, string, number]>(
        `insert into inflight (
           sid, idempotency_key, project_id, moment, image_prompt, credits_charged, started_at
         ) values (?, ?, null, null, null, null, ?)`,
      ).run(sid, idempotencyKey, nowMs)
      return { ok: true }
    }

    if (row.idempotency_key !== idempotencyKey) {
      return { ok: false, reason: "busy" }
    }

    if (row.project_id === null) {
      return { ok: false, reason: "in_progress" }
    }

    return { ok: true }
  })

  return run()
}

export function readInflight(db: LimitsDb, sid: string): InflightRow | null {
  const run = db.transaction((): InflightRow | null => {
    const row = selectInflight(db, sid)
    return row === undefined ? null : toInflightRow(row)
  })

  return run()
}

export function completeInflight(
  db: LimitsDb,
  sid: string,
  fields: {
    projectId: string
    moment: string
    imagePrompt: string
    creditsCharged: number
  },
): void {
  const run = db.transaction(() => {
    db.prepare<[string, string, string, number, string]>(
      `update inflight
       set project_id = ?, moment = ?, image_prompt = ?, credits_charged = ?
       where sid = ?`,
    ).run(fields.projectId, fields.moment, fields.imagePrompt, fields.creditsCharged, sid)
  })

  run()
}

export function clearInflight(db: LimitsDb, sid: string): void {
  const run = db.transaction(() => {
    db.prepare<[string]>("delete from inflight where sid = ?").run(sid)
  })

  run()
}

export function expireInflight(db: LimitsDb, nowMs: number): void {
  const run = db.transaction(() => {
    db.prepare<[number, number]>("delete from inflight where (? - started_at) > ?").run(
      nowMs,
      INFLIGHT_MAX_AGE_MS,
    )
  })

  run()
}
