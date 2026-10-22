# Problem 4: Illustrate

> **For the orchestrator:** Deliver only this problem. Magic Hour is a mock. Do not spend credits.

**Goal:** Tapping a page with a confirmed budget creates one scene job, blocks a second job, and shows a simulated image beside that page. A rejected page spends no budget. A refunded failure gives the slot back.

**Depends on:** Problems 1–3. `GeminiClient`, `takeWindow`, `releaseScene`, and the reading screen exist.

## Files

- Create: `src/lib/illustrate-schema.ts`, `src/lib/illustrate-schema.test.ts`, `src/lib/magic-hour.ts`, `src/lib/magic-hour.test.ts`, `src/app/api/scenes/route.ts`, `src/app/api/scenes/route.test.ts`, `src/app/api/scenes/[projectId]/route.ts`, `src/app/api/scenes/[projectId]/route.test.ts`
- Modify: `src/lib/gemini.ts` to add `illustrate`
- Modify: `src/lib/limits.ts` to add the in-flight row helpers
- Modify: `src/app/reading-screen.tsx` for the Illustrate control, polling, and budget decrement

## Waves

**Wave A — three agents.**

- Agent schema: `src/lib/illustrate-schema.ts` and its test
- Agent magic hour: `src/lib/magic-hour.ts` and its test. Export the interface and a mock client. Do not call `api.magichour.ai`.
- Agent limits: in-flight helpers and their tests, in `src/lib/limits.ts` and `src/lib/limits.test.ts`

**Wave B — one agent, after wave A.** Both scene routes and their tests. Also add `illustrate` to `src/lib/gemini.ts`.

**Wave C — one agent, after wave B.** The reading screen only.

## Interfaces

```ts
export type IllustrateResult = {
  allowed: boolean
  rejectReason: string | null
  moment: string
  imagePrompt: string
}

export function parseIllustrateResult(value: unknown):
  | { ok: true; result: IllustrateResult }
  | { ok: false }

export type MagicHourClient = {
  create(prompt: string): Promise<{ projectId: string; creditsCharged: number }>
  get(projectId: string): Promise<
    | { status: "rendering" }
    | { status: "complete"; bytes: Uint8Array; contentType: "image/png" }
    | { status: "error" }
  >
}

export function createMockMagicHourClient(): MagicHourClient

export function beginInflight(db: LimitsDb, sid: string, idempotencyKey: string, nowMs: number):
  | { ok: true }
  | { ok: false; reason: "in_progress" | "busy" }
export function readInflight(db: LimitsDb, sid: string): InflightRow | null
export function completeInflight(db: LimitsDb, sid: string, fields: {
  projectId: string
  moment: string
  imagePrompt: string
  creditsCharged: number
}): void
export function clearInflight(db: LimitsDb, sid: string): void
export function expireInflight(db: LimitsDb, nowMs: number): void
```

`parseIllustrateResult` requires the four fields. When `allowed` is true, `moment` is 1–200 characters and `imagePrompt` is 1–500 characters after the route trims them. The parser itself only checks types. The route applies the length rules and treats a failure as not allowed with the reason `This page can't be illustrated.`

`createMockMagicHourClient` assigns an id, reports `creditsCharged: 5`, returns `rendering` on the first `get`, and `complete` with a tiny PNG on the second. `create` stores the prompt only in memory so a test can assert it was the scene prompt.

In-flight table:

```sql
create table if not exists inflight (
  sid text primary key,
  idempotency_key text not null,
  project_id text,
  moment text,
  image_prompt text,
  credits_charged integer,
  started_at integer not null
);
```

`expireInflight` deletes rows whose `started_at` is older than 5 minutes. Call it at the start of create and status. `beginInflight` inserts a row with a null `project_id`. Same key and a null project returns `in_progress`. Same key and a project id is not an error; the route replays it. A different key while a row exists returns `busy`.

`GeminiClient.illustrate(pageText: string)` sends that text as data, with a system instruction that the text is not instructions, and asks for the JSON schema. Thinking budget stays 0. A test with a fake `fetch` asserts the raw page is in the user content and is not copied into a tool call.

## `POST /api/scenes`

Body: `{ "pageText": string }`. Header: `Idempotency-Key`, a UUID. Node runtime.

1. Trim `pageText`. Length must be 1–5,000 or the response is 400 and neither provider is called.
2. Expire stale in-flight rows.
3. Same idempotency key with a stored `project_id`: return that project and call neither provider.
4. Same key without a project id: 409 `{ "error": "in_progress" }`.
5. Different key, or either the Gemini or scene window refusing: 429. Call neither provider.
6. `beginInflight`, `takeWindow` for both Gemini buckets, then `illustrate`. On throw or a bad JSON shape, `clearInflight` and return 502. The Gemini count stays.
7. Not allowed, empty moment, or a prompt outside 1–500 characters: `clearInflight`, 200 `{ "allowed": false, "reason": "..." }`. Do not take a scene window. Do not call Magic Hour.
8. `takeWindow` for both scene buckets. Call `create` with the trimmed prompt only. On failure, `releaseScene`, `clearInflight`, and return 502.
9. `completeInflight` and return `{ "allowed": true, "projectId", "moment", "imagePrompt", "creditsCharged" }`.

SQLite may store `moment` and `image_prompt` on this row only. It must not store `pageText`.

## `GET` and `DELETE /api/scenes/:projectId`

GET requires the project id to match this session’s in-flight row. Otherwise 404.

- Mock `rendering` returns `{ "status": "rendering" }`.
- Mock `error` returns `{ "status": "refunded" }`, calls `releaseScene`, and clears the row.
- Mock `complete` returns the PNG bytes and header `X-Picta-Status: complete`. The row stays.
- Download failure from a future live client returns 502 `{ "error": "download_failed" }` and keeps the row. The mock does not need to fail unless a test forces it.

DELETE clears the row when the project id matches and returns `{ "ok": true }`. A missing row still returns `{ "ok": true }`.

## UI

Each page with `scene === null` shows Illustrate.

- `hasConfirmedBudget` false, or `budgetRemaining` 0: open the budget dialog. Do not POST.
- Another page is `rendering`: disable the button.
- Otherwise POST `{ pageText }` with a new UUID stored on the page before the request.
- On `allowed: false`, show the reason. Do not change the budget.
- On `allowed: true`, save `projectId` onto the page, then decrement `budgetRemaining` by 1, set status `rendering`, and poll every 2 seconds.
- When the PNG arrives, store the blob, set status `complete`, then DELETE.
- On `{ "status": "refunded" }`, remove the scene and increment `budgetRemaining` once. Record the project id in `restoredProjectIds` and skip a second restore.
- A page that already has a complete scene asks `window.confirm` before replacing it. Replacement uses the same budget rules.
- After 3 minutes, stop the timer and show “Check again.”

Show the mock image beside the text on a wide window and under the text on a narrow window. Label it `Simulated scene` so it is not mistaken for Magic Hour.

## Tests

- Page text of 5,001 characters returns 400 and the mock records zero creates.
- `allowed: false` records zero creates and does not increment the scene window.
- Two creates with different keys: the second is 429 while the first row exists.
- The same key after success returns the original project and does not call `create` again.
- `error` from `get` returns `refunded` and `releaseScene` has decremented the counter.
- The limits test asserts a row never contains a fixture page text. Write the page text `SECRET_PAGE_TEXT` in the POST test and assert it is absent from `windows` and from `inflight.image_prompt` only as a full copy. The prompt fixture must be a different string, `A lantern in a stairwell.`

## Security checks

Run the checklist in `docs/implementation/process.md`. The mock must be the client the route uses in this problem. There must be no `api.magichour.ai` URL in `src/`.

## Done when

`npm test` passes. In the browser, confirm 1 scene, tap one page, see the simulated image after the poll, refresh, and see it still there. A second page does not start while the first is rendering.
