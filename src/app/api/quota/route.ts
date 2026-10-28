import { NextResponse } from "next/server"
import { geminiConfigured } from "../../../lib/api-keys"
import { clientIp } from "../../../lib/client-ip"
import { openLimits, remainingWindow, type LimitsDb } from "../../../lib/limits"
import { attachSessionCookie, resolveSessionId } from "../session/route"

export const runtime = "nodejs"

const SCENE_WINDOW_MS = 24 * 60 * 60 * 1000
const GEMINI_WINDOW_MS = 60 * 60 * 1000
const SESSION_SCENE_CAP = 8
const IP_SCENE_CAP = 20
const SESSION_GEMINI_CAP = 20
const IP_GEMINI_CAP = 60

let limitsDb: LimitsDb | undefined

function sharedLimits(): LimitsDb {
  if (limitsDb === undefined) {
    limitsDb = process.env.VITEST ? openLimits(":memory:") : openLimits()
  }
  return limitsDb
}

export function limitsForTests(): LimitsDb {
  return sharedLimits()
}

type WindowSnapshot = {
  remaining: number
  resetsAt: number
}

function readRemaining(
  db: LimitsDb,
  bucket: string,
  nowMs: number,
  windowMs: number,
  cap: number,
): WindowSnapshot {
  const row = db
    .prepare<[string], { bucket: string }>("select bucket from windows where bucket = ?")
    .get(bucket)
  if (row === undefined) return { remaining: cap, resetsAt: 0 }
  return remainingWindow(db, bucket, nowMs, windowMs, cap)
}

function earlierReset(left: number, right: number): number {
  const times = [left, right].filter((time) => time > 0)
  if (times.length === 0) return 0
  return Math.min(...times)
}

function combineWindows(left: WindowSnapshot, right: WindowSnapshot): WindowSnapshot {
  if (left.remaining < right.remaining) {
    return { remaining: left.remaining, resetsAt: left.resetsAt }
  }
  if (right.remaining < left.remaining) {
    return { remaining: right.remaining, resetsAt: right.resetsAt }
  }
  return { remaining: left.remaining, resetsAt: earlierReset(left.resetsAt, right.resetsAt) }
}

function quotaFor(sessionId: string, ip: string) {
  const db = sharedLimits()
  const nowMs = Date.now()
  const scene = combineWindows(
    readRemaining(db, `sid:${sessionId}:scene`, nowMs, SCENE_WINDOW_MS, SESSION_SCENE_CAP),
    readRemaining(db, `ip:${ip}:scene`, nowMs, SCENE_WINDOW_MS, IP_SCENE_CAP),
  )
  const gemini = combineWindows(
    readRemaining(db, `sid:${sessionId}:gemini`, nowMs, GEMINI_WINDOW_MS, SESSION_GEMINI_CAP),
    readRemaining(db, `ip:${ip}:gemini`, nowMs, GEMINI_WINDOW_MS, IP_GEMINI_CAP),
  )
  return {
    sceneCreatesRemaining: scene.remaining,
    geminiCallsRemaining: gemini.remaining,
    sceneWindowResetsAt: scene.resetsAt,
    geminiWindowResetsAt: gemini.resetsAt,
    geminiConfigured: geminiConfigured(),
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const { id, isNew } = resolveSessionId(request)
  const response = NextResponse.json(quotaFor(id, clientIp(request.headers, null)))
  if (isNew) attachSessionCookie(response, request, id)
  return response
}
