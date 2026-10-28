import {
  GEMINI_KEY_HEADER,
  MAGIC_HOUR_KEY_HEADER,
  usableApiKey,
} from "./api-key-headers"

export type ResolvedApiKey =
  | { ok: true; apiKey: string }
  | { ok: false; error: "missing_api_key" }

export type SceneGemini =
  | { mode: "key"; apiKey: string }
  | { mode: "direct" }
  | { mode: "invalid" }

function headerValue(request: Request, name: string): string | null {
  const raw = request.headers.get(name)
  if (raw === null) return null
  return raw.trim()
}

function geminiFromEnv(): ResolvedApiKey {
  const raw = process.env.GEMINI_API_KEY
  if (typeof raw !== "string") return { ok: false, error: "missing_api_key" }
  const apiKey = usableApiKey(raw)
  if (apiKey === null) return { ok: false, error: "missing_api_key" }
  return { ok: true, apiKey }
}

export function geminiConfigured(): boolean {
  return geminiFromEnv().ok
}

export function resolveGeminiKey(request: Request): ResolvedApiKey {
  const header = headerValue(request, GEMINI_KEY_HEADER)
  if (header !== null && header.length > 0) {
    const apiKey = usableApiKey(header)
    if (apiKey === null) return { ok: false, error: "missing_api_key" }
    return { ok: true, apiKey }
  }
  return geminiFromEnv()
}

export function sceneGemini(request: Request): SceneGemini {
  const header = headerValue(request, GEMINI_KEY_HEADER)
  if (header !== null && header.length > 0) {
    const apiKey = usableApiKey(header)
    if (apiKey === null) return { mode: "invalid" }
    return { mode: "key", apiKey }
  }
  const env = geminiFromEnv()
  if (env.ok) return { mode: "key", apiKey: env.apiKey }
  return { mode: "direct" }
}

export function resolveMagicHourKey(request: Request): ResolvedApiKey {
  const header = headerValue(request, MAGIC_HOUR_KEY_HEADER)
  if (header === null || header.length === 0) return { ok: false, error: "missing_api_key" }
  const apiKey = usableApiKey(header)
  if (apiKey === null) return { ok: false, error: "missing_api_key" }
  return { ok: true, apiKey }
}
