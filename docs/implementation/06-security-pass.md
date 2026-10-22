# Problem 6: Security pass

> **For the orchestrator:** Deliver only this problem. Do not add a feature. Do not call live Gemini or Magic Hour.

**Goal:** Every route, secret, and input parser satisfies the security checklist, with a test where a claim can be proven by a test.

**Depends on:** Problems 1–5 are already in the tree.

## Files

- Modify only files that fail a check. Prefer a new test file `src/lib/security.test.ts` or a route test over a behavior change.
- Create `src/lib/security.test.ts` if a check does not already have a home.

Do not redesign the reading screen. Do not change credit numbers, model ids, or caps.

## Waves

**Wave A — one agent.** Read the checklist in `docs/implementation/process.md` and the route files under `src/app/api/`. Write the missing tests first.

**Wave B — one agent, only if wave A finds a failure.** Fix that failure. Re-run `npm test`.

One agent is enough for each wave. This problem is a review, and splitting it across agents would make them edit the same routes.

## Checks and the proof

| Check | Proof |
| --- | --- |
| `.env`, `.env.local`, `data/`, and `*.sqlite` are gitignored | A test or a documented command: `git check-ignore -v .env data/limits.sqlite` exits 0. `.env.example` values are empty. |
| No secret in the diff | `git grep` for `AIza`, `Bearer `, and `sk-` under `src/` returns nothing except the test literal `test-key` and the header name in the live client. |
| Bad bodies never call a provider | Existing route tests for transcribe and scenes. Add one if a route is uncovered. |
| Rate limit before providers | Existing 429 tests. Add one for any route that calls Gemini or Magic Hour without one. |
| Page text is not the Magic Hour prompt and is not stored | The Problem 4 fixture test still passes. Re-read `completeInflight` callers and confirm the column written is `imagePrompt`. |
| Logs do not contain page text, prompts, photos, or keys | Search `src/` for `console.log`, `console.info`, and `console.error`. Remove any that interpolate those values. A status and a project id are allowed. |
| Forwarded IP header | The Problem 2 test still passes. |

Also confirm:

- Route files export `runtime = "nodejs"` where they import `better-sqlite3`.
- Client components do not import `src/lib/magic-hour.ts`, `src/lib/gemini.ts`, or `src/lib/limits.ts`.
- `POST /api/scenes` still rejects a page whose illustrate result is `allowed: false` without calling `create`.

If a check already has a test, do not duplicate it. Point at the test in the handoff.

## Done when

`npm test` passes, `git status` shows no secret files, and the handoff lists each checklist row as passing with the file that proves it.

No new button, route, or screen.
