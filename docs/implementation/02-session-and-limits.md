# Problem 2: Session and limits

> **For the orchestrator:** Deliver only this problem. Do not read Problem 3 or later.

**Goal:** The browser gets a session cookie, the server counts scene and Gemini windows in SQLite, and the budget dialog cannot offer more scenes than `GET /api/quota` allows.

**Depends on:** Problem 1. `maxConfirmable` and the reading screen already exist.

## Files

- Create: `src/lib/limits.ts`, `src/lib/limits.test.ts`, `src/lib/client-ip.ts`, `src/lib/client-ip.test.ts`, `src/app/api/session/route.ts`, `src/app/api/quota/route.ts`
- Modify: `src/app/reading-screen.tsx` so the budget dialog uses the quota endpoint
- Modify: `package.json` to add `better-sqlite3` and `@types/better-sqlite3`
- Create on boot, and gitignore already covers it: `data/limits.sqlite`

Do not create Gemini or Magic Hour clients. Do not log request bodies.

## Waves

**Wave A — two agents.**

- Agent limits: `src/lib/limits.ts` and its test. It may add the dependency.
- Agent IP: `src/lib/client-ip.ts` and its test.

**Wave B — one agent, after wave A.** Both route files, then the budget dialog. This agent is the only one that edits `reading-screen.tsx`.

## Interfaces

```ts
export function openLimits(filename?: string): LimitsDb

export function takeWindow(
  db: LimitsDb,
  bucket: string,
  nowMs: number,
  windowMs: number,
  cap: number,
): { ok: true } | { ok: false; resetsAt: number }

export function remainingWindow(
  db: LimitsDb,
  bucket: string,
  nowMs: number,
  windowMs: number,
  cap: number,
): { remaining: number; resetsAt: number }

export function releaseScene(db: LimitsDb, sessionId: string, ip: string): void

export function clientIp(headers: Headers, socketAddress: string | null): string
```

`openLimits()` with no argument uses `data/limits.sqlite` and creates the directory. Tests pass `":memory:"`.

Buckets:

- `sid:<id>:scene` and `ip:<addr>:scene` use a 24-hour window and caps 8 and 20
- `sid:<id>:gemini` and `ip:<addr>:gemini` use a 1-hour window and caps 20 and 60

`takeWindow` increments only when the request fits. When `nowMs - window_start` is greater than the window, the count resets to 0 and `window_start` becomes `nowMs` before the check. A refusal does not increment. `resetsAt` is `window_start + windowMs`.

`releaseScene` decrements both the session and IP scene buckets by 1 and does not go below 0. Problem 4 calls it on a refunded render. This problem only has to prove the function.

`clientIp` returns `socketAddress` or `"unknown"`. It uses the leftmost `X-Forwarded-For` value only when `process.env.TRUSTED_PROXY === "true"`.

SQLite tables:

```sql
create table if not exists windows (
  bucket text primary key,
  count integer not null,
  window_start integer not null
);
```

Do not create the in-flight table in this problem. Problem 4 owns it.

## Routes

Both routes use the Node.js runtime (`export const runtime = "nodejs"`).

`POST /api/session` sets `picta_sid` when the cookie is missing. The value is 32 random bytes, hex encoded. Flags: HttpOnly, SameSite=Lax, Path=/, Max-Age=30 days, Secure when the request URL is HTTPS. Response: `{ "ok": true }`.

`GET /api/quota` ensures the cookie, then returns:

```json
{
  "sceneCreatesRemaining": 8,
  "geminiCallsRemaining": 20,
  "sceneWindowResetsAt": 0,
  "geminiWindowResetsAt": 0
}
```

`sceneCreatesRemaining` is the lesser of the session scene remainder and the IP scene remainder. `geminiCallsRemaining` is the same pair for the Gemini buckets. This route does not increment. It only reads.

## Tests

Limits, against `:memory:`:

- The 8th session scene take succeeds and the 9th returns `ok: false` with a `resetsAt` in the future.
- A take 24 hours and 1 millisecond later succeeds again.
- A refused take leaves the count unchanged.
- `releaseScene` turns a full session bucket from 8 back to 7, and a second release at 0 stays at 0.

IP:

- With `TRUSTED_PROXY` unset, header `X-Forwarded-For: 1.2.3.4` and socket `9.9.9.9` returns `9.9.9.9`.
- With `TRUSTED_PROXY=true`, the same header returns `1.2.3.4`.

Route tests can call the handler functions with a fake request if booting Next is awkward. They must show that two quota reads do not change `remainingWindow`.

## UI

On opening the budget dialog, `POST /api/session`, then `GET /api/quota`. Pass `sceneCreatesRemaining` from that response into `maxConfirmable`. If the quota request fails, the dialog says the limit could not be loaded and the confirm button stays disabled. Do not fall back to 8.

Show the scene reset time when `sceneCreatesRemaining` is 0.

## Security checks

- Quota and session return without reading a provider env var.
- A test covers the ignored forwarding header.
- `data/` is gitignored. The test suite must not write `data/limits.sqlite`; memory databases only.
- No log of the cookie value.

## Done when

`npm test` passes. In the browser, confirming a budget still works, and the maximum the dialog accepts is the number from `/api/quota`.
