import { NextResponse } from "next/server"
import { resolveMagicHourKey } from "../../../../lib/api-keys"
import { clientIp } from "../../../../lib/client-ip"
import { clearInflight, expireInflight, readInflight, releaseScene } from "../../../../lib/limits"
import type { MagicHourClient } from "../../../../lib/magic-hour"
import { RejectedApiKeyError } from "../../../../lib/rejected-api-key"
import { attachSessionCookie, resolveSessionId } from "../../session/route"
import { getLimitsDb, resolveMagicHour } from "../shared"

export const runtime = "nodejs"

type SessionState = { id: string; isNew: boolean }

type SceneDeps = {
  magicHour?: MagicHourClient
}

function json(request: Request, session: SessionState, body: object, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  if (session.isNew) attachSessionCookie(response, request, session.id)
  return response
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
  deps?: SceneDeps,
): Promise<Response> {
  const session = resolveSessionId(request)
  const { projectId } = await context.params
  const db = getLimitsDb()
  expireInflight(db, Date.now())

  const row = readInflight(db, session.id)
  if (row === null || row.projectId !== projectId) {
    return json(request, session, { error: "not_found" }, 404)
  }

  let magicHourKey: string | undefined
  if (deps?.magicHour === undefined) {
    const resolved = resolveMagicHourKey(request)
    if (!resolved.ok) return json(request, session, { error: "missing_api_key" }, 400)
    magicHourKey = resolved.apiKey
  }
  const magic = resolveMagicHour(deps?.magicHour, magicHourKey)
  if (magic === null) return json(request, session, { error: "missing_api_key" }, 400)
  const magicHour = magic.client
  try {
    const result = await magicHour.get(projectId)
    if (result.status === "rendering") {
      return json(request, session, { status: "rendering" })
    }
    if (result.status === "error") {
      releaseScene(db, session.id, clientIp(request.headers, null))
      clearInflight(db, session.id)
      return json(request, session, { status: "refunded" })
    }
    const response = new NextResponse(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "X-Picta-Status": "complete",
      },
    })
    if (session.isNew) attachSessionCookie(response, request, session.id)
    return response
  } catch (error) {
    if (error instanceof RejectedApiKeyError) {
      return json(request, session, { error: "rejected_api_key" }, 401)
    }
    return json(request, session, { error: "download_failed" }, 502)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
  deps?: SceneDeps,
): Promise<Response> {
  const session = resolveSessionId(request)
  const { projectId } = await context.params
  const db = getLimitsDb()
  const row = readInflight(db, session.id)
  if (row !== null && row.projectId === projectId) {
    clearInflight(db, session.id)
  }
  return json(request, session, { ok: true })
}
