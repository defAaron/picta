import { NextResponse } from "next/server"
import { resolveMagicHourKey, sceneGemini } from "../../../lib/api-keys"
import { directScenePrompt } from "../../../lib/direct-scene"
import { clientIp } from "../../../lib/client-ip"
import { createGeminiClient, GeminiRequestError, type GeminiClient } from "../../../lib/gemini"
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
import { InsufficientCreditsError, type MagicHourClient } from "../../../lib/magic-hour"
import { RejectedApiKeyError } from "../../../lib/rejected-api-key"
import { attachSessionCookie, resolveSessionId } from "../session/route"
import { getLimitsDb, resolveMagicHour } from "./shared"

export const runtime = "nodejs"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const SESSION_GEMINI_CAP = 20
const IP_GEMINI_CAP = 60
const SESSION_SCENE_CAP = 8
const IP_SCENE_CAP = 20
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

function blockedReset(
  db: LimitsDb,
  sid: string,
  ip: string,
  nowMs: number,
  skipGemini = false,
): number | null {
  const checks: Array<readonly [string, number, number]> = []
  if (!skipGemini) {
    checks.push([`sid:${sid}:gemini`, HOUR_MS, SESSION_GEMINI_CAP])
    checks.push([`ip:${ip}:gemini`, HOUR_MS, IP_GEMINI_CAP])
  }
  checks.push([`sid:${sid}:scene`, DAY_MS, SESSION_SCENE_CAP])
  checks.push([`ip:${ip}:scene`, DAY_MS, IP_SCENE_CAP])
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

function refusalReason(result: IllustrateResult, moment: string, imagePrompt: string): string | null {
  const momentOk = moment.length >= 1 && moment.length <= 200
  const promptOk = imagePrompt.length >= 1
  if (result.allowed === true && momentOk && promptOk) return null
  if (result.allowed === false) {
    const reason = result.rejectReason === null ? "" : result.rejectReason.trim()
    if (reason.length > 0) return reason.slice(0, 200)
  }
  return CANNOT_ILLUSTRATE
}

function allowedScenePayload(
  projectId: string,
  moment: string,
  imagePrompt: string,
  creditsCharged: number,
  simulated: boolean,
): {
  allowed: true
  projectId: string
  moment: string
  imagePrompt: string
  creditsCharged: number
  simulated?: true
} {
  const body = {
    allowed: true as const,
    projectId,
    moment,
    imagePrompt,
    creditsCharged,
  }
  if (!simulated) return body
  return { ...body, simulated: true }
}

function injectedDeps(second: SceneDeps | ScenesContext | undefined): SceneDeps {
  if (second === undefined || "params" in second) return {}
  return second
}

async function illustratePage(
  gemini: GeminiClient,
  pageText: string,
): Promise<{ ok: true; result: IllustrateResult } | { ok: false; code: string }> {
  let value: unknown
  try {
    value = await gemini.illustrate(pageText)
  } catch (error) {
    if (error instanceof RejectedApiKeyError || error instanceof GeminiRequestError) throw error
    const parse =
      error instanceof Error &&
      (error.message === "Gemini response missing text" || error.message === "Gemini response text was not valid JSON")
    return { ok: false, code: parse ? "gemini_parse" : "illustrate_unavailable" }
  }
  const parsed = parseIllustrateResult(value)
  if (!parsed.ok) return { ok: false, code: "gemini_parse" }
  return parsed
}

function geminiFailureCode(status: number): string {
  if (status === 400) return "gemini_400"
  if (status === 402) return "gemini_402"
  if (status === 404) return "gemini_404"
  if (status === 429) return "gemini_429"
  if (status === 500 || status === 503) return "gemini_busy"
  return "gemini_unavailable"
}

export async function POST(
  request: Request,
  deps?: SceneDeps | ScenesContext,
): Promise<Response> {
  const injected = injectedDeps(deps)
  const session = resolveSessionId(request)
  const page = await readPage(request)
  if (!page.ok) return json(request, session, { error: "bad_page" }, 400)

  let geminiKey: string | undefined
  let direct = false
  if (injected.gemini === undefined) {
    const choice = sceneGemini(request)
    if (choice.mode === "invalid") return json(request, session, { error: "missing_api_key" }, 400)
    if (choice.mode === "direct") direct = true
    else geminiKey = choice.apiKey
  }
  let magicHourKey: string | undefined
  if (injected.magicHour === undefined) {
    const resolved = resolveMagicHourKey(request)
    if (!resolved.ok) return json(request, session, { error: "missing_api_key" }, 400)
    magicHourKey = resolved.apiKey
  }

  const db = getLimitsDb()
  const nowMs = Date.now()
  const ip = clientIp(request.headers, null)
  expireInflight(db, nowMs)

  const existing = readInflight(db, session.id)
  if (existing !== null && existing.idempotencyKey === page.idempotencyKey) {
    if (existing.projectId !== null) {
      const simulated = resolveMagicHour(injected.magicHour, magicHourKey)?.simulated === true
      return json(
        request,
        session,
        allowedScenePayload(
          existing.projectId,
          existing.moment ?? "",
          existing.imagePrompt ?? "",
          existing.creditsCharged ?? 0,
          simulated,
        ),
      )
    }
    return json(request, session, { error: "in_progress" }, 409)
  }
  if (existing !== null) {
    return json(request, session, { error: "busy" }, 429)
  }

  const blocked = blockedReset(db, session.id, ip, nowMs, direct)
  if (blocked !== null) {
    return json(request, session, { error: "rate_limited", resetsAt: blocked }, 429)
  }

  let directScene: { prompt: string; moment: string } | null = null
  if (direct) {
    const prepared = directScenePrompt(page.pageText)
    if (!prepared.ok) return json(request, session, { allowed: false, reason: prepared.reason })
    directScene = { prompt: prepared.prompt, moment: prepared.moment }
  }

  const begun = beginInflight(db, session.id, page.idempotencyKey, nowMs)
  if (!begun.ok) {
    if (begun.reason === "in_progress") {
      return json(request, session, { error: "in_progress" }, 409)
    }
    return json(request, session, { error: "busy" }, 429)
  }

  let illustrated: IllustrateResult
  if (directScene) {
    illustrated = {
      allowed: true,
      rejectReason: null,
      moment: directScene.moment,
      imagePrompt: directScene.prompt,
    }
  } else {
    const gemini = injected.gemini ?? createGeminiClient(geminiKey ?? "")
    const geminiReset = takeGemini(db, session.id, ip, nowMs)
    if (geminiReset !== null) {
      clearInflight(db, session.id)
      return json(request, session, { error: "rate_limited", resetsAt: geminiReset }, 429)
    }
    let parsed: { ok: true; result: IllustrateResult } | { ok: false; code: string }
    try {
      parsed = await illustratePage(gemini, page.pageText)
    } catch (error) {
      clearInflight(db, session.id)
      if (error instanceof RejectedApiKeyError) {
        return json(request, session, { error: "rejected_api_key" }, 401)
      }
      if (error instanceof GeminiRequestError) {
        return json(request, session, { error: geminiFailureCode(error.status) }, 502)
      }
      throw error
    }
    if (!parsed.ok) {
      clearInflight(db, session.id)
      return json(request, session, { error: parsed.code }, 502)
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

  const magic = resolveMagicHour(injected.magicHour, magicHourKey)
  if (magic === null) {
    releaseScene(db, session.id, ip)
    clearInflight(db, session.id)
    return json(request, session, { error: "missing_api_key" }, 400)
  }
  const { client: magicHour, simulated } = magic
  try {
    const created = await magicHour.create(imagePrompt)
    completeInflight(db, session.id, {
      projectId: created.projectId,
      moment,
      imagePrompt,
      creditsCharged: created.creditsCharged,
    })
    return json(
      request,
      session,
      allowedScenePayload(created.projectId, moment, imagePrompt, created.creditsCharged, simulated),
    )
  } catch (error) {
    releaseScene(db, session.id, ip)
    clearInflight(db, session.id)
    if (error instanceof RejectedApiKeyError) {
      return json(request, session, { error: "rejected_api_key" }, 401)
    }
    if (error instanceof InsufficientCreditsError) {
      return json(request, session, { error: "insufficient_credits" }, 402)
    }
    if (error instanceof Error && (error.message === "magic_hour_create_failed" || error.message === "magic_hour_request_failed")) {
      return json(request, session, { error: "magic_hour" }, 502)
    }
    return json(request, session, { error: "illustrate_unavailable" }, 502)
  }
}
