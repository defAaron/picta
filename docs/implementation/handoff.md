# Handoff

**Finished:** Problem 5 — Live scenes and the page frame
**Next:** Problem 6 — Security pass
**Do this next:** Prove the security checklist with tests, and change code only where a check fails. Do not add a feature.

## Read

- docs/implementation/06-security-pass.md
- docs/implementation/process.md (security checks)
- src/app/api/session/route.ts
- src/app/api/quota/route.ts
- src/app/api/transcribe/route.ts
- src/app/api/scenes/route.ts
- src/app/api/scenes/shared.ts
- src/app/api/scenes/[projectId]/route.ts
- src/lib/magic-hour.ts
- src/lib/compose.ts

## Do not read

- docs/implementation/01-local-reading.md
- docs/implementation/02-session-and-limits.md
- docs/implementation/03-transcribe.md
- docs/implementation/04-illustrate.md
- docs/implementation/05-live-scenes-and-page-frame.md
- src/lib/pages.ts, src/lib/budget.ts, and src/lib/reading-store.ts
- docs/prd.md and docs/architecture.md

## Trust these

- `createLiveMagicHourClient(apiKey, fetchImpl?)` — posts to `https://api.magichour.ai/v1/ai-image-generator` with `Authorization: Bearer` plus the key argument. Body is `z-image-turbo`, `image_count` 1, `resolution` `640px`, `aspect_ratio` `1:1`, `style.tool` `general`, and `style.prompt` is the image prompt. HTTP 402 throws `InsufficientCreditsError`. `get` reads `downloads[0].url` and downloads it without the bearer token.
- `createMockMagicHourClient()` — still the client when `MAGIC_HOUR_API_KEY` is empty. POST then includes `"simulated": true`.
- A missing `GEMINI_API_KEY` with no injected client returns 502 `{ "error": "illustrate_unavailable" }` and does not invent a prompt.
- `sceneFrame(1000, 2000)` — `{ x: 80, y: 1160, width: 840, height: 840 }`. The frame is inset 8% on each side and is the lower 42% of the photo.
- `OnPageView` — draws that frame. The reading screen shows “See it on the page” only when the page has a photo and a complete scene image.
- The caption “Simulated scene” is shown only when `scene.simulated` is true.

## Do not redo

Pasting, the quota dialog, transcription, and the Illustrate poll already work. Do not change credit numbers, model ids, or caps. Do not call live Gemini or Magic Hour from the test suite.
