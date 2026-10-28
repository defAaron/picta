# Handoff

**Finished:** Problem 6 — Security pass, then typed keys
**Next:** none — the plan is finished
**Do this next:** Nothing in the plan. The reading screen asks for a Gemini key and a Magic Hour key the first time a photo or a scene needs them. A blank Gemini key uses `GEMINI_API_KEY`. Magic Hour uses only the typed key. Both stay in that tab until refresh.

## Read

- docs/implementation/process.md (security checks only)

## Do not read

- docs/prd.md and docs/architecture.md

## Trust these

- `resolveGeminiKey`: a usable `X-Picta-Gemini-Key` wins; otherwise `GEMINI_API_KEY`. `resolveMagicHourKey` reads only `X-Picta-Magic-Hour-Key`.
- `sceneGemini`: no usable Gemini key means mode `direct`. The scene prompt is the page text, trimmed, at most 1,500 characters.
- A 401, 403, or Gemini `API_KEY_` 400 throws `RejectedApiKeyError`. Those routes return 401 `{ "error": "rejected_api_key" }`.
- Gemini model id is `gemini-3.8-flash` with `thinkingLevel` `low`.
- `npm test` — 144 passed, 1 skipped. The skipped test is the PNG compose check, because this Node process has no `OffscreenCanvas`.
- Live calls happen only when the matching key is set. Tests use fake fetch and the literals `test-key` and `env-key`.

## Do not redo

The reading screen, the quota, transcription, scenes, and the key dialog are finished. Do not add a button, a route, or a screen.
