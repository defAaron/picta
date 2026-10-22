# Handoff

**Finished:** Problem 4 — Illustrate
**Next:** Problem 5 — Live scenes and the page frame
**Do this next:** With a Magic Hour key, render a real 640px scene, and let a photographed page show that scene on the photo. Without the key, keep the simulated scene.

## Read

- docs/implementation/05-live-scenes-and-page-frame.md
- docs/implementation/README.md (global constraints only)
- src/lib/magic-hour.ts
- src/app/api/scenes/route.ts
- src/app/api/scenes/shared.ts
- src/app/api/scenes/[projectId]/route.ts
- src/app/reading-screen.tsx
- src/lib/gemini.ts

## Do not read

- docs/implementation/06-security-pass.md
- docs/implementation/01-local-reading.md
- docs/implementation/02-session-and-limits.md
- docs/implementation/03-transcribe.md
- docs/implementation/04-illustrate.md
- src/lib/pages.ts, src/lib/budget.ts, src/lib/reading-store.ts, and src/lib/types.ts
- docs/prd.md and docs/architecture.md

## Trust these

- `parseIllustrateResult(value)` — plain object with boolean `allowed`, string-or-null `rejectReason`, and string `moment` and `imagePrompt`. Length checks are the route's job. Anything else is `{ ok: false }`.
- `createMockMagicHourClient()` — `create` stores the prompt in memory and returns `creditsCharged: 5`. The first `get` is `rendering`; the second is a PNG. `mockPrompts` and `mockFailNext(client, "error" | "download")` are the test hooks. There is no live Magic Hour call yet.
- `beginInflight`, `readInflight`, `completeInflight`, `clearInflight`, `expireInflight` — one row per session. The prompt may sit on that row. Page text is not a column. Rows older than 5 minutes are deleted.
- `POST /api/scenes` — JSON `{ "pageText" }` and a UUID `Idempotency-Key`. Bad text is 400 `{ "error": "bad_page" }` and calls neither provider. A second key is 429 `{ "error": "busy" }`. The same key without a project is 409 `{ "error": "in_progress" }`. A finished key replays the project. With no `GEMINI_API_KEY` and no injected client, the route skips Gemini and asks the mock for the fixed prompt `A lantern in a stairwell.`
- `GET /api/scenes/:projectId` — `rendering`, PNG with `X-Picta-Status: complete`, or `{ "status": "refunded" }` after `releaseScene`. A thrown download is 502 `{ "error": "download_failed" }` and keeps the row.
- `DELETE /api/scenes/:projectId` — `{ "ok": true }`. It clears the row only when the project id matches.
- The Illustrate button spends one local budget slot, disables every Illustrate button while a page is rendering, polls every 2 seconds, and stops after 3 minutes with “Check again.” The caption is “Simulated scene.”

## Do not redo

Pasting, the quota dialog, photo transcription, and the mocked illustrate flow already work. A refresh keeps the scene image. Do not remove the mock path.
