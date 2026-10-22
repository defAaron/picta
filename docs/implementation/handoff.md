# Handoff

**Finished:** Problem 3 — Transcribe
**Next:** Problem 4 — Illustrate
**Do this next:** Tapping a page with a confirmed budget starts one mocked scene, blocks a second tap while it is in flight, and returns the slot when that job fails.

## Read

- docs/implementation/04-illustrate.md
- docs/implementation/README.md (global constraints only)
- src/app/reading-screen.tsx
- src/lib/gemini.ts
- src/lib/limits.ts
- src/lib/client-ip.ts
- src/app/api/session/route.ts
- src/app/api/transcribe/route.ts

## Do not read

- docs/implementation/05-live-scenes-and-page-frame.md
- docs/implementation/06-security-pass.md
- docs/implementation/01-local-reading.md
- docs/implementation/02-session-and-limits.md
- docs/implementation/03-transcribe.md
- src/lib/pages.ts, src/lib/budget.ts, src/lib/reading-store.ts, and src/lib/types.ts
- docs/prd.md and docs/architecture.md

## Trust these

- `parseTranscribeResult(value)` — accepts only a plain object with boolean `accepted` and `singlePage`, string `text`, and string-or-null `rejectReason`. Extra fields are ignored. Anything else is `{ ok: false }`.
- `createGeminiClient(apiKey, fetchImpl?)` — `transcribe(image, mimeType)` posts to `gemini-2.5-flash` with `thinkingBudget` 0, no tools, and the line `Transcribe this image.` It returns `JSON.parse` of the first candidate text part, or throws.
- `POST /api/transcribe` — multipart field `image`. JPEG, PNG, or WebP, 1 byte through 8 MB. A bad image is 400 `{ "error": "bad_image" }` and does not call Gemini or `takeWindow`. Gemini buckets are `sid:<id>:gemini` (cap 20, 1h) and `ip:<addr>:gemini` (cap 60, 1h). A full window is 429 `{ "error": "rate_limited", "resetsAt" }` with zero Gemini calls. An empty `GEMINI_API_KEY` with no injected client is 502 `{ "error": "transcribe_unavailable" }`. `singlePage: false` returns 200 and the reason `Photograph one page at a time.` Accepted text is trimmed. The handler is `POST(request, client?)`.
- `takeWindow`, `remainingWindow`, `releaseScene`, and `openLimits` — same guarantees as Problem 2. Tests use `":memory:"`. The transcribe route keeps one module-level database and exports `limitsForTests()`.
- `clientIp(headers, socketAddress)` — ignores `X-Forwarded-For` unless `TRUSTED_PROXY` is the string `"true"`.
- `resolveSessionId` and `attachSessionCookie` — `picta_sid`, 32 random bytes hex, HttpOnly, SameSite=Lax, Path=/, 30 days, Secure only on HTTPS.

## Do not redo

Pasting, joining, splitting, and the quota-capped budget dialog already work. "Add a page photo" sends one file. A declined or failed transcription does not add a page. The transcription stays editable. There is no Illustrate button yet.
