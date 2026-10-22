# Handoff

**Finished:** Problem 6 — Security pass
**Next:** none — the plan is finished
**Do this next:** Nothing in the plan. Add `GEMINI_API_KEY` and `MAGIC_HOUR_API_KEY` to `.env.local` when you want live transcription and scenes.

## Read

- docs/implementation/process.md (security checks only)

## Do not read

- docs/prd.md and docs/architecture.md

## Checklist

| Check | Proof |
| --- | --- |
| `.env`, `.env.local`, `data/`, and `*.sqlite` are gitignored. `.env.example` values are empty. | `src/lib/security.test.ts` |
| No secret in `src/` except `test-key` and the live `Bearer ${apiKey}` header. | `src/lib/security.test.ts` |
| A bad body never calls a provider. | `src/app/api/transcribe/route.test.ts`, `src/app/api/scenes/route.test.ts` |
| A rate limit refuses before Gemini or Magic Hour. | `src/app/api/transcribe/route.test.ts`, `src/app/api/scenes/route.test.ts` |
| Page text is not the image prompt and is not stored. | `src/app/api/scenes/route.test.ts`, `src/lib/limits.test.ts` |
| Logs do not contain page text, prompts, photos, or keys. | `src/lib/security.test.ts` |
| `X-Forwarded-For` is ignored unless `TRUSTED_PROXY` is `true`. | `src/lib/client-ip.test.ts`, `src/app/api/quota/route.test.ts` |
| Routes that use SQLite set `runtime = "nodejs"`. | `src/lib/security.test.ts` |
| Client components do not import the Magic Hour, Gemini, or limits modules. | `src/lib/security.test.ts` |
| `allowed: false` does not call Magic Hour. | `src/app/api/scenes/route.test.ts` |

## Trust these

- `npm test` — 107 passed, 1 skipped. The skipped test is the PNG compose check, because this Node process has no `OffscreenCanvas`.
- Live calls happen only when the matching key is set. Tests use fake fetch and the literal `test-key`.

## Do not redo

The reading screen, the quota, transcription, the mock scene, and the live client are finished. Do not add a button, a route, or a screen for this pass.
