import { NextResponse } from "next/server"
import { clientIp } from "../../../lib/client-ip"
import { createGeminiClient, type GeminiClient } from "../../../lib/gemini"
import { parseIllustrateResult, type IllustrateResult } from "../../../lib/illustrate-schema"
import {
  beginInflight,
  clearInflight,
  completeInflight,
  expireInflight,
  readInflight,
  releaseScene,
  remainingWindow,
  takeWindow,
  type LimitsDb,
} from "../../../lib/limits"
import type { MagicHourClient } from "../../../lib/magic-hour"
import { attachSessionCookie, resolveSessionId } from "../session/route"
import { defaultMagicHour, getLimitsDb } from "./shared"

export const runtime = "nodejs"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const SESSION_GEMINI_CAP = 20
const IP_GEMINI_CAP = 60
const SESSION_SCENE_CAP = 8
const IP_SCENE_CAP = 20
const FALLBACK_MOMENT = "A quiet corner of the page"
const FALLBACK_PROMPT = "A lantern in a stairwell."
const CANNOT_ILLUSTRATE = "This page can't be illustrated."
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SessionState = { id: string; isNew: boolean }

type SceneDeps = {
  gemini?: GeminiClient
  magicHour?: MagicHourClient
}

type ScenesContext = {
  params: Promise<unknown>
}

function json(request: Request, session: SessionState, body: object, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  if (session.isNew) attachSessionCookie(response, request, session.id)
  return response
}

async function readPage(request: Request): Promise<
  { ok: true; pageText: string; idempotencyKey: string } | { ok: false }
> {
  const header = request.headers.get("Idempotency-Key")
  if (header === null) return { ok: false }
  const idempotencyKey = header.trim()
  if (!UUID_PATTERN.test(idempotencyKey)) return { ok: false }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { ok: false }
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false }
  const pageText = (body as { pageText?: unknown }).pageText
  if (typeof pageText !== "string") return { ok: false }
  const trimmed = pageText.trim()
  if (trimmed.length < 1 || trimmed.length > 5000) return { ok: false }
  return { ok: true, pageText: trimmed, idempotencyKey }
}

function blockedReset(db: LimitsDb, sid: string, ip: string, nowMs: number): number | null {
  const checks = [
    [`sid:${sid}:gemini`, HOUR_MS, SESSION_GEMINI_CAP],
    [`ip:${ip}:gemini`, HOUR_MS, IP_GEMINI_CAP],
    [`sid:${sid}:scene`, DAY_MS, SESSION_SCENE_CAP],
    [`ip:${ip}:scene`, DAY_MS, IP_SCENE_CAP],
  ] as const
  for (const [bucket, windowMs, cap] of checks) {
    const window = remainingWindow(db, bucket, nowMs, windowMs, cap)
    if (window.remaining === 0) return window.resetsAt
  }
  return null
}

function takeGemini(db: LimitsDb, sid: string, ip: string, nowMs: number): number | null {
  const sidTake = takeWindow(db, `sid:${sid}:gemini`, nowMs, HOUR_MS, SESSION_GEMINI_CAP)
  if (!sidTake.ok) return sidTake.resetsAt
  const ipTake = takeWindow(db, `ip:${ip}:gemini`, nowMs, HOUR_MS, IP_GEMINI_CAP)
  if (!ipTake.ok) return ipTake.resetsAt
  return null
}

function takeScene(
  db: LimitsDb,
  sid: string,
  ip: string,
  nowMs: number,
): { ok: true } | { ok: false; resetsAt: number; release: boolean } {
  const sidTake = takeWindow(db, `sid:${sid}:scene`, nowMs, DAY_MS, SESSION_SCENE_CAP)
  if (!sidTake.ok) return { ok: false, resetsAt: sidTake.resetsAt, release: false }
  const ipTake = takeWindow(db, `ip:${ip}:scene`, nowMs, DAY_MS, IP_SCENE_CAP)
  if (!ipTake.ok) return { ok: false, resetsAt: ipTake.resetsAt, release: true }
  return { ok: true }
}

function resolveGemini(client: GeminiClient | undefined): GeminiClient | null {
  if (client !== undefined) return client
  const apiKey = process.env.GEMINI_API_KEY
  if (typeof apiKey !== "string" || apiKey.length === 0) return null
  return createGeminiClient(apiKey)
}

function refusalReason(result: IllustrateResult, moment: string, imagePrompt: string): string | null {
  const momentOk = moment.length >= 1 && moment.length <= 200
  const promptOk = imagePrompt.length >= 1 && imagePrompt.length <= 500
  if (result.allowed === true && momentOk && promptOk) return null
  if (result.allowed === false) {
    const reason = result.rejectReason === null ? "" : result.rejectReason.trim()
    if (reason.length > 0) return reason.slice(0, 200)
  }
  return CANNOT_ILLUSTRATE
}

function injectedDeps(second: SceneDeps | ScenesContext | undefined): SceneDeps {
  if (second === undefined || "params" in second) return {}
  return second
}

async function illustratePage(
  gemini: GeminiClient,
  pageText: string,
): Promise<{ ok: true; result: IllustrateResult } | { ok: false }> {
  try {
    return parseIllustrateResult(await gemini.illustrate(pageText))
  } catch {
    return { ok: false }
  }
}

export async function POST(
  request: Request,
  deps?: SceneDeps | ScenesContext,
): Promise<Response> {
  const injected = injectedDeps(deps)
  const session = resolveSessionId(request)
  const page = await readPage(request)
  if (!page.ok) return json(request, session, { error: "bad_page" }, 400)

  const db = getLimitsDb()
  const nowMs = Date.now()
  const ip = clientIp(request.headers, null)
  expireInflight(db, nowMs)

  const existing = readInflight(db, session.id)
  if (existing !== null && existing.idempotencyKey === page.idempotencyKey) {
    if (existing.projectId !== null) {
      return json(request, session, {
        allowed: true,
        projectId: existing.projectId,
        moment: existing.moment ?? "",
        imagePrompt: existing.imagePrompt ?? "",
        creditsCharged: existing.creditsCharged ?? 0,
      })
    }
    return json(request, session, { error: "in_progress" }, 409)
  }
  if (existing !== null) {
    return json(request, session, { error: "busy" }, 429)
  }

  const blocked = blockedReset(db, session.id, ip, nowMs)
  if (blocked !== null) {
    return json(request, session, { error: "rate_limited", resetsAt: blocked }, 429)
  }

  const begun = beginInflight(db, session.id, page.idempotencyKey, nowMs)
  if (!begun.ok) {
    if (begun.reason === "in_progress") {
      return json(request, session, { error: "in_progress" }, 409)
    }
    return json(request, session, { error: "busy" }, 429)
  }

  const gemini = resolveGemini(injected.gemini)
  let illustrated: IllustrateResult
  if (gemini === null) {
    illustrated = {
      allowed: true,
      rejectReason: null,
      moment: FALLBACK_MOMENT,
      imagePrompt: FALLBACK_PROMPT,
    }
  } else {
    const geminiReset = takeGemini(db, session.id, ip, nowMs)
    if (geminiReset !== null) {
      clearInflight(db, session.id)
      return json(request, session, { error: "rate_limited", resetsAt: geminiReset }, 429)
    }
    const parsed = await illustratePage(gemini, page.pageText)
    if (!parsed.ok) {
      clearInflight(db, session.id)
      return json(request, session, { error: "illustrate_unavailable" }, 502)
    }
    illustrated = parsed.result
  }

  const moment = illustrated.moment.trim()
  const imagePrompt = illustrated.imagePrompt.trim()
  const reason = refusalReason(illustrated, moment, imagePrompt)
  if (reason !== null) {
    clearInflight(db, session.id)
    return json(request, session, { allowed: false, reason })
  }

  const scene = takeScene(db, session.id, ip, nowMs)
  if (!scene.ok) {
    if (scene.release) releaseScene(db, session.id, ip)
    clearInflight(db, session.id)
    return json(request, session, { error: "rate_limited", resetsAt: scene.resetsAt }, 429)
  }

  const magicHour = injected.magicHour ?? defaultMagicHour()
  try {
    const created = await magicHour.create(imagePrompt)
    completeInflight(db, session.id, {
      projectId: created.projectId,
      moment,
      imagePrompt,
      creditsCharged: created.creditsCharged,
    })
    return json(request, session, {
      allowed: true,
      projectId: created.projectId,
      moment,
      imagePrompt,
      creditsCharged: created.creditsCharged,
    })
  } catch {
    releaseScene(db, session.id, ip)
    clearInflight(db, session.id)
    return json(request, session, { error: "illustrate_unavailable" }, 502)
  }
}
