# Handoff

**Finished:** Problem 2 — Session and limits
**Next:** Problem 3 — Transcribe
**Do this next:** Let the reader add one page photo, turn an accepted transcription into a page, and decline a photo that is not a single book page.

## Read

- docs/implementation/03-transcribe.md
- docs/implementation/README.md (global constraints only)
- src/app/reading-screen.tsx
- src/lib/limits.ts
- src/lib/client-ip.ts
- src/app/api/session/route.ts
- src/app/api/quota/route.ts

## Do not read

- docs/implementation/04-illustrate.md
- docs/implementation/05-live-scenes-and-page-frame.md
- docs/implementation/06-security-pass.md
- docs/implementation/01-local-reading.md
- docs/implementation/02-session-and-limits.md
- src/lib/pages.ts, src/lib/budget.ts, src/lib/reading-store.ts, and src/lib/types.ts
- docs/prd.md and docs/architecture.md

## Trust these

- `openLimits(filename?: string): LimitsDb` — no argument uses `data/limits.sqlite` and creates the directory. Tests pass `":memory:"`.
- `takeWindow(db, bucket, nowMs, windowMs, cap)` — increments only when the request fits. Resets when `nowMs - window_start > windowMs`. A refusal does not increment.
- `remainingWindow(db, bucket, nowMs, windowMs, cap)` — reads only. Does not increment.
- `releaseScene(db, sessionId, ip)` — decrements `sid:<id>:scene` and `ip:<addr>:scene` and does not go below 0.
- `clientIp(headers, socketAddress)` — socket address, or `"unknown"`. Leftmost `X-Forwarded-For` only when `TRUSTED_PROXY` is the string `"true"`.
- `POST /api/session` — sets `picta_sid` (32 random bytes, hex) when missing. HttpOnly, SameSite=Lax, Path=/, Max-Age=30 days, Secure only on HTTPS. Returns `{ "ok": true }`.
- `GET /api/quota` — ensures the cookie and does not increment. `sceneCreatesRemaining` is the lesser of the session scene remainder (cap 8, 24h) and the IP scene remainder (cap 20, 24h). `geminiCallsRemaining` is the lesser of the Gemini pair (caps 20 and 60, 1h). A fresh database returns remainders 8 and 20 and both reset times 0.
- `resolveSessionId` and `attachSessionCookie` in `src/app/api/session/route.ts`.
- Quota and transcribe tests must not create `data/limits.sqlite`. The quota route keeps one module-level database and uses `":memory:"` when `VITEST` is set. `limitsForTests()` returns that database.

## Do not redo

Pasting, reordering, joining, and splitting pages already works. Confirming a budget still only updates IndexedDB. The budget dialog loads the quota when it opens, refuses a count above `sceneCreatesRemaining`, and stays disabled if that request fails. There is no photo upload and no Illustrate button.
