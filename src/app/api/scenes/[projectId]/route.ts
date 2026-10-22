import { NextResponse } from "next/server"
import { clientIp } from "../../../../lib/client-ip"
import { clearInflight, expireInflight, readInflight, releaseScene } from "../../../../lib/limits"
import type { MagicHourClient } from "../../../../lib/magic-hour"
import { attachSessionCookie, resolveSessionId } from "../../session/route"
import { defaultMagicHour, getLimitsDb } from "../shared"

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

  const magicHour = deps?.magicHour ?? defaultMagicHour()
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
  } catch {
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
