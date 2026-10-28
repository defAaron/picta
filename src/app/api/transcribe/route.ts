import { NextResponse } from "next/server"
import { resolveGeminiKey } from "../../../lib/api-keys"
import { clientIp } from "../../../lib/client-ip"
import { createGeminiClient, type GeminiClient } from "../../../lib/gemini"
import { RejectedApiKeyError } from "../../../lib/rejected-api-key"
import { openLimits, remainingWindow, takeWindow, type LimitsDb } from "../../../lib/limits"
import { parseTranscribeResult, type TranscribeResult } from "../../../lib/transcribe-schema"
import { attachSessionCookie, resolveSessionId } from "../session/route"

export const runtime = "nodejs"

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const GEMINI_WINDOW_MS = 60 * 60 * 1000
const SESSION_GEMINI_CAP = 20
const IP_GEMINI_CAP = 60
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const ONE_PAGE_REASON = "Photograph one page at a time."
const EMPTY_TEXT_REASON = "The transcription was empty."

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

type SessionState = { id: string; isNew: boolean }

function respond(request: Request, session: SessionState, body: object, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  if (session.isNew) attachSessionCookie(response, request, session.id)
  return response
}

async function readImage(request: Request): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return null
  }
  const image = form.get("image")
  if (!(image instanceof File)) return null
  if (!IMAGE_TYPES.has(image.type)) return null
  if (image.size === 0 || image.size > MAX_IMAGE_BYTES) return null
  try {
    const bytes = new Uint8Array(await image.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null
    return { bytes, mimeType: image.type }
  } catch {
    return null
  }
}

function geminiRefusal(sessionId: string, ip: string): number | null {
  const db = sharedLimits()
  const nowMs = Date.now()
  const sessionBucket = `sid:${sessionId}:gemini`
  const ipBucket = `ip:${ip}:gemini`
  const sessionWindow = remainingWindow(db, sessionBucket, nowMs, GEMINI_WINDOW_MS, SESSION_GEMINI_CAP)
  if (sessionWindow.remaining === 0) return sessionWindow.resetsAt
  const ipWindow = remainingWindow(db, ipBucket, nowMs, GEMINI_WINDOW_MS, IP_GEMINI_CAP)
  if (ipWindow.remaining === 0) return ipWindow.resetsAt
  const sessionTake = takeWindow(db, sessionBucket, nowMs, GEMINI_WINDOW_MS, SESSION_GEMINI_CAP)
  if (!sessionTake.ok) return sessionTake.resetsAt
  const ipTake = takeWindow(db, ipBucket, nowMs, GEMINI_WINDOW_MS, IP_GEMINI_CAP)
  if (!ipTake.ok) return ipTake.resetsAt
  return null
}

function outcome(result: TranscribeResult): { accepted: false; reason: string } | { accepted: true; text: string } {
  if (result.singlePage !== true) {
    return { accepted: false, reason: ONE_PAGE_REASON }
  }
  if (result.accepted !== true) {
    const reason = result.rejectReason === null ? "" : result.rejectReason.trim().slice(0, 200)
    return { accepted: false, reason }
  }
  const text = result.text.trim()
  if (text.length === 0) {
    return { accepted: false, reason: EMPTY_TEXT_REASON }
  }
  return { accepted: true, text }
}

export async function POST(request: Request, client?: GeminiClient): Promise<NextResponse> {
  const session = resolveSessionId(request)
  const image = await readImage(request)
  if (image === null) {
    return respond(request, session, { error: "bad_image" }, 400)
  }

  let gemini: GeminiClient
  if (client !== undefined && typeof client.transcribe === "function") {
    gemini = client
  } else {
    const resolved = resolveGeminiKey(request)
    if (!resolved.ok) return respond(request, session, { error: "missing_api_key" }, 400)
    gemini = createGeminiClient(resolved.apiKey)
  }

  const resetsAt = geminiRefusal(session.id, clientIp(request.headers, null))
  if (resetsAt !== null) {
    return respond(request, session, { error: "rate_limited", resetsAt }, 429)
  }

  let raw: unknown
  try {
    raw = await gemini.transcribe(image.bytes, image.mimeType)
  } catch (error) {
    if (error instanceof RejectedApiKeyError) {
      return respond(request, session, { error: "rejected_api_key" }, 401)
    }
    return respond(request, session, { error: "transcribe_unavailable" }, 502)
  }

  const parsed = parseTranscribeResult(raw)
  if (!parsed.ok) {
    return respond(request, session, { error: "transcribe_unavailable" }, 502)
  }

  return respond(request, session, outcome(parsed.result))
}
