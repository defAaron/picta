import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

const SESSION_COOKIE = "picta_sid"
const SESSION_MAX_AGE_SECONDS = 2_592_000

function readSessionId(request: Request): string | null {
  const header = request.headers.get("cookie")
  if (header === null) return null
  for (const part of header.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    if (name !== SESSION_COOKIE) continue
    const raw = part.slice(separator + 1).trim()
    if (raw.length === 0) return null
    try {
      const value = decodeURIComponent(raw)
      return value.length > 0 ? value : null
    } catch {
      return raw
    }
  }
  return null
}

function requestIsHttps(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
}

export function resolveSessionId(request: Request): { id: string; isNew: boolean } {
  const existing = readSessionId(request)
  if (existing !== null) return { id: existing, isNew: false }
  return { id: randomBytes(32).toString("hex"), isNew: true }
}

export function attachSessionCookie(response: NextResponse, request: Request, id: string): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: id,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: requestIsHttps(request),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  const { id, isNew } = resolveSessionId(request)
  const response = NextResponse.json({ ok: true })
  if (isNew) attachSessionCookie(response, request, id)
  return response
}
